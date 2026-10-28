import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, asc, eq, inArray, pushTokens } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { apnsConfigured } from '../../lib/apns.js';
import { validKeys } from '../../lib/web-push.js';
import { resolveSafe } from '../../lib/safe-fetch.js';

const APNS_TOKEN = { type: 'string', pattern: '^[0-9a-fA-F]{64,200}$' };
const ENDPOINT_MAX = 1000;
const B64URL = (min: number, max: number) => ({ type: 'string', pattern: `^[A-Za-z0-9_-]{${min},${max}}={0,2}$` });
/** Installs per account: every push fans out to all of them, so the list cannot grow without end. */
const MAX_INSTALLS = 10;
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/** A UnifiedPush endpoint: https on a public host (http only to this machine outside production). */
async function checkEndpoint(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'That is not a URL';
  }
  const local = process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && LOOPBACK.includes(url.hostname);
  if (url.protocol !== 'https:' && !local) return 'Push endpoints must be https://';
  if (url.username || url.password || url.hash) return 'That push endpoint is not allowed';
  try {
    await resolveSafe(url);
  } catch {
    return 'That push endpoint is not on a public host';
  }
  return null;
}

/**
 * Mobile app installs register where to push once signed in: an APNs device token on iOS, a
 * UnifiedPush endpoint with its Web Push keys on Android.
 */
export const pushRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/push/config: which push this instance can send, so the app can say when it
   * cannot. `ntfy` is this instance's own UnifiedPush server, if it runs one.
   */
  app.get('/config', { config: { public: true } }, async () => ({
    apns: apnsConfigured(),
    unifiedpush: true,
    ntfy: process.env.UNIFIEDPUSH_SERVER || null,
  }));

  /**
   * POST /api/v1/push/tokens
   *   { kind: 'apns', token }  or  { kind: 'unifiedpush', endpoint, p256dh, auth }
   * A token or endpoint moves to whoever signs in on that install.
   */
  app.post(
    '/tokens',
    {
      schema: {
        body: {
          oneOf: [
            { type: 'object', additionalProperties: false, required: ['kind', 'token'], properties: { kind: { const: 'apns' }, token: APNS_TOKEN } },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'endpoint', 'p256dh', 'auth'],
              properties: { kind: { const: 'unifiedpush' }, endpoint: { type: 'string', maxLength: ENDPOINT_MAX }, p256dh: B64URL(86, 88), auth: B64URL(21, 24) },
            },
          ],
        },
      },
    },
    async (request, reply) => {
      const auth = extractAuthToken(request)!;
      const body = request.body as { kind: 'apns'; token: string } | { kind: 'unifiedpush'; endpoint: string; p256dh: string; auth: string };
      let row: { token: string; kind: string; platform: string; p256dh: string | null; auth: string | null };
      if (body.kind === 'apns') {
        if (!apnsConfigured()) return reply.status(409).send({ error: 'This instance has no Apple push key, so iOS push is unavailable' });
        row = { token: body.token.toLowerCase(), kind: 'apns', platform: 'ios', p256dh: null, auth: null };
      } else {
        const bad = await checkEndpoint(body.endpoint);
        if (bad) return reply.status(400).send({ error: bad });
        if (!validKeys(body.p256dh, body.auth)) return reply.status(400).send({ error: 'Those push keys are not valid' });
        row = { token: body.endpoint, kind: 'unifiedpush', platform: 'android', p256dh: body.p256dh, auth: body.auth };
      }
      await db
        .insert(pushTokens)
        .values({ ...row, transmitterId: auth.transmitterId })
        .onConflictDoUpdate({ target: pushTokens.token, set: { ...row, transmitterId: auth.transmitterId, createdAt: new Date() } });
      // Oldest installs beyond the limit stop getting pushes.
      const mine = await db.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.transmitterId, auth.transmitterId)).orderBy(asc(pushTokens.createdAt));
      const extra = mine.slice(0, Math.max(0, mine.length - MAX_INSTALLS)).map((t: any) => t.token);
      if (extra.length) await db.delete(pushTokens).where(and(eq(pushTokens.transmitterId, auth.transmitterId), inArray(pushTokens.token, extra)));
      return reply.status(204).send();
    }
  );

  /** POST /api/v1/push/tokens/remove  { token } (a token or an endpoint): on sign-out; only your own. */
  app.post(
    '/tokens/remove',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', minLength: 1, maxLength: ENDPOINT_MAX } } } } },
    async (request, reply) => {
      const auth = extractAuthToken(request)!;
      const { token } = request.body as { token: string };
      const value = /^[0-9a-fA-F]+$/.test(token) ? token.toLowerCase() : token;
      await db.delete(pushTokens).where(and(eq(pushTokens.token, value), eq(pushTokens.transmitterId, auth.transmitterId)));
      return reply.status(204).send();
    }
  );
};
