import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

/**
 * Outbound HTTP for link previews and the media proxy. Every hop (including redirects) is
 * resolved first and refused if any address is private, loopback, link-local, CGNAT,
 * multicast or reserved; the request is then pinned to the checked address so a second
 * DNS answer cannot swap in an internal one.
 */

const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const v4ToInt = (ip: string) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;

function isPrivateV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address to eight 16-bit groups. */
function v6Groups(ip: string): number[] | null {
  let addr = ip.toLowerCase().split('%')[0];
  // Trailing dotted IPv4 (::ffff:1.2.3.4) becomes two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const n = v4ToInt(v4[1]);
    addr = addr.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
  if (t === null && h.length !== 8) return null;
  const fill = t === null ? [] : Array(8 - h.length - t.length).fill('0');
  const groups = [...h, ...fill, ...(t ?? [])].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96) carry an IPv4 address.
  const embedded = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(embedded);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embedded);
  // IPv4-translated (::ffff:0:a.b.c.d) carries one too.
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return isPrivateV4(embedded);
  // 6to4 (2002::/16) embeds the IPv4 address in its second and third groups.
  if (g[0] === 0x2002) return isPrivateV4(`${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`);
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
  if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo: tunnels to anywhere
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return true;
}

/**
 * Hosts that may resolve to private addresses. Only honoured outside production, so the
 * browser test suite can preview a page served on localhost.
 */
function allowedPrivateHosts(): Set<string> {
  if (process.env.NODE_ENV === 'production') return new Set();
  return new Set(
    (process.env.UNFURL_ALLOW_PRIVATE_HOSTS || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );
}

export class UnsafeUrlError extends Error {
  code = 'INVALID_URL_TARGET';
}

export interface SafeResponse {
  status: number;
  url: string;
  contentType: string;
  body: Buffer;
  /** True when the body was cut off at maxBytes. */
  truncated: boolean;
}

export interface SafeGetOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  /** Stop reading once this much of an HTML page has arrived (the <head> is enough). */
  stopAfterBytes?: number;
}

/** Resolve a URL's host and return an address that is safe to connect to. */
export async function resolveSafe(target: URL): Promise<{ address: string; family: number }> {
  if (!['http:', 'https:'].includes(target.protocol)) throw new UnsafeUrlError('Only http and https links can be previewed');
  if (target.username || target.password) throw new UnsafeUrlError('Links with credentials are not previewed');
  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowPrivate = allowedPrivateHosts().has(host);
  const literal = net.isIP(host);
  const addresses = literal ? [{ address: host, family: literal }] : await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new UnsafeUrlError('Host does not resolve');
  if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError('Host resolves to a restricted address');
  return addresses[0];
}

export async function safeGet(rawUrl: string, opts: SafeGetOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 5000;
  let url = new URL(rawUrl);
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const pinned = await resolveSafe(url);
    const res = await new Promise<SafeResponse & { location?: string }>((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const req = client.get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SubspaceBot/1.0; +https://subspace.click)',
            Accept: opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
            'Accept-Language': 'en',
          },
          // Connect to the address we checked, never a fresh lookup.
          lookup: (_host, options, cb) => {
            if ((options as { all?: boolean }).all) (cb as any)(null, [{ address: pinned.address, family: pinned.family }]);
            else (cb as any)(null, pinned.address, pinned.family);
          },
          timeout: Math.max(500, deadline - Date.now()),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            return resolve({ status, url: url.href, contentType: '', body: Buffer.alloc(0), truncated: false, location: response.headers.location });
          }
          const contentType = String(response.headers['content-type'] || '').toLowerCase();
          const declared = Number(response.headers['content-length'] || 0);
          if (declared > maxBytes && !opts.stopAfterBytes) {
            response.destroy();
            return reject(new Error('Response too large'));
          }
          const chunks: Buffer[] = [];
          let size = 0;
          const limit = opts.stopAfterBytes ?? maxBytes;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            chunks.push(chunk);
            if (size >= limit) {
              response.destroy();
              if (!opts.stopAfterBytes) return reject(new Error('Response too large'));
              resolve({ status, url: url.href, contentType, body: Buffer.concat(chunks).subarray(0, limit), truncated: true });
            }
          });
          response.on('end', () => resolve({ status, url: url.href, contentType, body: Buffer.concat(chunks), truncated: false }));
          response.on('error', reject);
        }
      );
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', reject);
    });
    if (!res.location) return res;
    url = new URL(res.location, url);
  }
  throw new Error('Too many redirects');
}

/**
 * A POST to an outside server (bot interaction endpoints), under the same rules as safeGet: the
 * host is resolved and checked, the connection pinned to that address, redirects not followed.
 */
export async function safePost(rawUrl: string, body: string, headers: Record<string, string>, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<SafeResponse> {
  const url = new URL(rawUrl);
  const pinned = await resolveSafe(url);
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  return new Promise<SafeResponse>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { 'User-Agent': 'SubspaceBot/1.0 (+https://subspace.click)', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
        lookup: (_host, options, cb) => {
          if ((options as { all?: boolean }).all) (cb as any)(null, [{ address: pinned.address, family: pinned.family }]);
          else (cb as any)(null, pinned.address, pinned.family);
        },
        timeout: opts.timeoutMs ?? 3000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) return response.destroy(new Error('Response too large'));
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, url: url.href, contentType: String(response.headers['content-type'] || ''), body: Buffer.concat(chunks), truncated: false }));
        response.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
