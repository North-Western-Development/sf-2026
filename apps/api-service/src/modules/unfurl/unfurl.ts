import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface UnfurledMetadata {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  thumbnail?: string;
  favicon?: string;
}

/**
 * SSRF Safety Guard:
 * Blocks localhost, loopback IPs, private subnets (RFC 1918), and link-local cloud metadata (169.254.169.254)
 */
export function isSafeUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();

    // Block localhost & short names
    if (host === 'localhost' || !host.includes('.')) {
      return false;
    }

    // Check for IP patterns
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = host.match(ipv4Regex);
    if (match) {
      const b1 = parseInt(match[1], 10);
      const b2 = parseInt(match[2], 10);

      // 127.0.0.0/8 (Loopback)
      if (b1 === 127) return false;
      // 10.0.0.0/8 (Private)
      if (b1 === 10) return false;
      // 172.16.0.0/12 (Private)
      if (b1 === 172 && b2 >= 16 && b2 <= 31) return false;
      // 192.168.0.0/16 (Private)
      if (b1 === 192 && b2 === 168) return false;
      // 169.254.0.0/16 (Link-local / Cloud Metadata like 169.254.169.254)
      if (b1 === 169 && b2 === 254) return false;
      // 0.0.0.0
      if (b1 === 0) return false;
    }

    // Block IPv6 loopback / unique local
    if (host === '::1' || host.startsWith('fc00:') || host.startsWith('fe80:')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Extract OpenGraph & HTML meta tags from raw HTML snippet
 */
export function parseMetadata(html: string, originalUrl: string): UnfurledMetadata {
  const result: UnfurledMetadata = { url: originalUrl };

  // Title
  const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1];
  const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  result.title = ogTitle || titleTag || undefined;

  // Description
  const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1];
  const metaDesc = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1];
  result.description = ogDesc || metaDesc || undefined;

  // Site name
  const ogSiteName = html.match(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i)?.[1];
  result.siteName = ogSiteName || undefined;

  // Image / Thumbnail
  const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1];
  result.thumbnail = ogImage || undefined;

  return result;
}

export const unfurlRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/v1/unfurl
   * SSRF-safe URL preview metadata generator
   */
  app.post('/unfurl', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const body = request.body as any;
    const { url } = body || {};

    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'url parameter required' });
    }

    if (!isSafeUrl(url)) {
      return reply.status(400).send({
        error: 'Target URL is invalid or targets restricted network address',
        code: 'INVALID_URL_TARGET',
      });
    }

    try {
      const parsedUrl = new URL(url);
      const requester = parsedUrl.protocol === 'https:' ? https : http;

      const htmlSnippet = await new Promise<string>((resolve, reject) => {
        const req = requester.get(
          url,
          {
            headers: {
              'User-Agent': 'SubspaceFrequency-Bot/0.1.0 (+https://subspace.click)',
              Accept: 'text/html,application/xhtml+xml',
            },
            timeout: 3000,
          },
          (res) => {
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
              return resolve('');
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              data += chunk;
              if (data.length > 50000) {
                res.destroy();
                resolve(data);
              }
            });
            res.on('end', () => resolve(data));
          }
        );

        req.on('timeout', () => {
          req.destroy();
          resolve('');
        });
        req.on('error', (err) => reject(err));
      });

      const metadata = parseMetadata(htmlSnippet, url);
      return reply.send({ metadata });
    } catch (err: any) {
      return reply.status(502).send({
        error: 'Failed to unfurl target URL',
        code: 'UNFURL_FAILED',
        details: err.message,
      });
    }
  });
};
