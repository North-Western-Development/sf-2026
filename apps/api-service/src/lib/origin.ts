import type { FastifyRequest } from 'fastify';

/** Origins this instance serves: WEBAUTHN_ORIGINS, else PUBLIC_ORIGIN (comma-separated). */
export function configuredOrigins(): string[] {
  return (process.env.WEBAUTHN_ORIGINS || process.env.PUBLIC_ORIGIN || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/**
 * The browser origin of a request, if this site may use it for passkeys and links in email.
 * Production accepts only configured origins; development also accepts localhost.
 */
export function trustedOrigin(request: FastifyRequest): URL | null {
  let url: URL;
  try {
    url = new URL(String(request.headers.origin || ''));
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  if (configuredOrigins().includes(url.origin) || (process.env.NODE_ENV !== 'production' && local)) return url;
  return null;
}

/** Base URL for links in email: EMAIL_LINK_BASE, else the trusted request origin, else PUBLIC_ORIGIN. */
export function linkBase(request?: FastifyRequest): string {
  const fixed = process.env.EMAIL_LINK_BASE?.replace(/\/$/, '');
  if (fixed) return fixed;
  const fromRequest = request ? trustedOrigin(request) : null;
  return fromRequest?.origin ?? configuredOrigins()[0] ?? 'http://localhost:5173';
}
