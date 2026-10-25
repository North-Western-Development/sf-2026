import crypto from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { and, eq, accountConnections } from '@subspace/database';
import { getJwtSecret } from '@subspace/crypto';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import {
  CONNECTION_PROVIDERS,
  authorizeUrl,
  isConnectionConfigured,
  oauthIdentity,
  steamIdentity,
  type ConnectionProvider,
} from '../../lib/connections.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const COOKIE = 'subspace_connection_oauth';
const COOKIE_PATH = '/api/v1/connections';
const MAX_CONNECTIONS = 20;
const NAMES: Record<ConnectionProvider, string> = { github: 'GitHub', google: 'Google', microsoft: 'Microsoft', dropbox: 'Dropbox', steam: 'Steam' };

const key = () => crypto.createHash('sha256').update(`connections-state:${getJwtSecret()}`).digest();
function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
function unseal<T>(sealed: string): T | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}

interface State {
  t: string; // transmitter
  p: ConnectionProvider;
  v: string; // PKCE verifier
  n: string; // nonce, also in an HttpOnly cookie of the browser that started it
  r: string; // redirect URI
  e: number; // expiry (ms)
}

const cookieValue = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Where the sign-in popup lands: tells the opener and closes. */
function popupPage(reply: FastifyReply, ok: boolean, message: string, provider?: string) {
  const payload = JSON.stringify({ type: 'subspace-connection', provider: provider ?? null, ok, message }).replace(/</g, '\\u003c');
  return reply
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('Set-Cookie', `${COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`)
    .status(ok ? 200 : 400)
    .send(
      `<!doctype html><meta charset="utf-8"><title>Subspace Connections</title>` +
        `<body style="background:#07080c;color:#eef1fa;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0">` +
        `<p>${escapeHtml(message)}</p>` +
        `<script>try{window.opener&&window.opener.postMessage(${payload},location.origin)}catch(e){}setTimeout(function(){window.close()},${ok ? 300 : 4000})</script>`
    );
}

const providerParam = { type: 'object', required: ['provider'], properties: { provider: { type: 'string', enum: CONNECTION_PROVIDERS } } };
export const serializeConnection = (c: any) => ({ id: c.id, provider: c.provider, name: c.name, url: c.url, visible: c.visible, createdAt: c.createdAt });

/**
 * Connections (User Settings › Connections):
 *   GET    /users/@me/connections                       yours, and which providers this site offers
 *   POST   /users/@me/connections/:provider/authorize   the sign-in URL for a popup
 *   GET    /connections/:provider/callback              where the provider sends the popup back
 *   PATCH  /users/@me/connections/:id                   { visible }
 *   DELETE /users/@me/connections/:id
 * Visible connections appear on the profile (profiles.routes.ts).
 */
export const connectionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  app.get('/users/@me/connections', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const rows = await db.select().from(accountConnections).where(eq(accountConnections.transmitterId, token.transmitterId)).orderBy(accountConnections.createdAt);
    return reply.send({
      connections: rows.map(serializeConnection),
      providers: CONNECTION_PROVIDERS.map((p) => ({ provider: p, name: NAMES[p], available: isConnectionConfigured(p) })),
    });
  });

  app.post('/users/@me/connections/:provider/authorize', { schema: { params: providerParam } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { provider } = request.params as { provider: ConnectionProvider };
    if (!isConnectionConfigured(provider)) return reply.status(400).send({ error: `${NAMES[provider]} is not set up on this server.`, code: 'CONNECTION_NOT_CONFIGURED' });
    const base = (process.env.CONNECTIONS_REDIRECT_BASE || process.env.DRIVE_REDIRECT_BASE || String(request.headers.origin || '') || process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
    if (!/^https?:\/\/[^/]+$/.test(base)) return reply.status(400).send({ error: 'Could not work out this site’s address for the sign-in redirect.', code: 'NO_REDIRECT_BASE' });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    const redirectUri = `${base}${COOKIE_PATH}/${provider}/callback`;
    const state = seal({ t: token.transmitterId, p: provider, v: verifier, n: nonce, r: redirectUri, e: Date.now() + STATE_TTL_MS } satisfies State);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const secure = base.startsWith('https:') ? '; Secure' : '';
    reply.header('Set-Cookie', `${COOKIE}=${nonce}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
    return reply.send({ url: authorizeUrl(provider, { redirectUri, state, challenge, realm: base }) });
  });

  app.get(
    '/connections/:provider/callback',
    { config: { public: true }, schema: { params: providerParam } },
    async (request, reply) => {
      const { provider } = request.params as { provider: ConnectionProvider };
      const query = request.query as Record<string, string>;
      const name = NAMES[provider];
      if (query.error) return popupPage(reply, false, `${name} was not connected.`, provider);
      const st = typeof query.state === 'string' && query.state.length < 4096 ? unseal<State>(query.state) : null;
      const nonce = cookieValue(request.headers.cookie, COOKIE);
      if (!st || st.p !== provider || st.e < Date.now() || !nonce || nonce.length !== st.n.length || !crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(st.n))) {
        return popupPage(reply, false, 'This sign-in link is invalid or has expired. Start again from Connections.', provider);
      }
      if (!db) return popupPage(reply, false, 'Connections are unavailable right now.', provider);
      try {
        const identity =
          provider === 'steam'
            ? await steamIdentity(query, st.r)
            : await (async () => {
                if (typeof query.code !== 'string' || query.code.length > 4096) throw new Error('no code');
                return oauthIdentity(provider, query.code, st.r, st.v);
              })();
        const mine = await db.select({ id: accountConnections.id }).from(accountConnections).where(eq(accountConnections.transmitterId, st.t));
        if (mine.length >= MAX_CONNECTIONS) return popupPage(reply, false, `You can have up to ${MAX_CONNECTIONS} connections.`, provider);
        await db
          .insert(accountConnections)
          .values({ transmitterId: st.t, provider, providerAccountId: identity.id, name: identity.name.slice(0, 100), url: identity.url })
          .onConflictDoUpdate({
            target: [accountConnections.transmitterId, accountConnections.provider, accountConnections.providerAccountId],
            set: { name: identity.name.slice(0, 100), url: identity.url },
          });
        return popupPage(reply, true, `${name} connected. You can close this window.`, provider);
      } catch (err) {
        app.log.warn({ err: (err as Error).message, provider }, '[Connections] sign-in failed');
        return popupPage(reply, false, `${name} could not be connected. Try again.`, provider);
      }
    }
  );

  app.patch(
    '/users/@me/connections/:id',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['visible'], properties: { visible: { type: 'boolean' } } } } },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { id } = request.params as { id: string };
      if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(404).send({ error: 'Connection not found' });
      const [row] = await db
        .update(accountConnections)
        .set({ visible: (request.body as { visible: boolean }).visible })
        .where(and(eq(accountConnections.id, id), eq(accountConnections.transmitterId, token.transmitterId)))
        .returning();
      if (!row) return reply.status(404).send({ error: 'Connection not found' });
      return reply.send({ connection: serializeConnection(row) });
    }
  );

  app.delete('/users/@me/connections/:id', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { id } = request.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(404).send({ error: 'Connection not found' });
    await db.delete(accountConnections).where(and(eq(accountConnections.id, id), eq(accountConnections.transmitterId, token.transmitterId)));
    return reply.status(204).send();
  });
};
