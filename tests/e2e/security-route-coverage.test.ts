import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { buildApp } from '../../apps/api-service/src/index.js';
import { buildFileApp } from '../../apps/file-service/src/index.js';
import { getJwtSecret } from '@subspace/crypto';

/**
 * Endpoint coverage: sweeps EVERY route the services register, so a new route cannot
 * ship without an authentication decision. Each route must reject anonymous and forged
 * credentials with 401, unless it is listed in PUBLIC below with a reason.
 */
const PUBLIC: Record<string, string> = {
  'GET /health': 'liveness probe',
  'POST /api/v1/auth/register': 'sign-up',
  'POST /api/v1/auth/login': 'sign-in',
  'POST /api/v1/auth/2fa/verify': 'second factor; authenticated by the challenge token in the body',
  'POST /api/v1/auth/refresh': 'authenticated by the refresh token in the body',
  'POST /api/v1/auth/logout': 'idempotent; revokes the refresh token in the body',
  'GET /api/v1/auth/directives': 'platform rules shown on the sign-up page',
  'GET /api/v1/invites/:code': 'invite preview for signed-out visitors',
  'GET /api/v1/system/info': 'instance name and terminology, no user data',
  'GET /api/v1/embed-proxy': 'embed images load in <img> tags; only fetches URLs the server signed',
  'GET /api/v1/vault/drives/:provider/callback': 'OAuth popup landing; sealed state names the account and an HttpOnly cookie binds it to the browser',
  'GET /api/v1/vault/files/:id': 'attachment links work in <img> tags; unguessable ids, as the upload disclaimer states',
};

const UUID = '00000000-0000-4000-8000-00000000dead';
const fill = (url: string) => url.replace(/:[A-Za-z]+/g, (p) => (p === ':code' ? 'nonexistent' : UUID)).replace(/\*$/, 'x');
const key = (r: { method: string; url: string }) => `${r.method} ${r.url}`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Minimal HS256 signer, so tokens can be forged with the wrong secret or claims. */
const sign = (claims: Record<string, unknown>, secret: string) => {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat: Math.floor(Date.now() / 1000), ...claims })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};

describe('Security: every endpoint has an authentication decision', () => {
  const SECRET = getJwtSecret();
  let api: FastifyInstance;
  let files: FastifyInstance;
  let routes: Array<{ app: FastifyInstance; method: string; url: string }> = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    api = await buildApp();
    files = await buildFileApp();
    await Promise.all([api.ready(), files.ready()]);
    const seen = new Set<string>();
    for (const app of [api, files]) {
      for (const r of (app as any).routeTable as Array<{ method: string; url: string }>) {
        if (seen.has(key(r))) continue;
        seen.add(key(r));
        routes.push({ app, ...r });
      }
    }
  });

  afterAll(async () => {
    await Promise.all([api.close(), files.close()]);
  });

  const forged = () => ({
    none: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ transmitterId: UUID, username: 'x', typ: 'access' })}.`,
    wrongSecret: sign({ transmitterId: UUID, username: 'x', staffRank: 9, typ: 'access' }, 'not-the-real-secret'),
    expired: sign({ transmitterId: UUID, username: 'x', staffRank: 0, typ: 'access', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET),
    refreshAsAccess: sign({ transmitterId: UUID, username: 'x', typ: 'refresh', exp: Math.floor(Date.now() / 1000) + 600 }, SECRET),
  });

  it('found the routes to sweep', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('every non-public route rejects anonymous callers with 401', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      if (PUBLIC[key(r)]) continue;
      const res = await r.app.inject({ method: r.method as any, url: fill(r.url), payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
      if (res.statusCode !== 401) leaks.push(`${key(r)} -> ${res.statusCode}`);
    }
    expect(leaks).toEqual([]);
  });

  it('every non-public route rejects forged, expired and wrong-type tokens with 401', async () => {
    const leaks: string[] = [];
    const tokens = forged();
    for (const r of routes) {
      if (PUBLIC[key(r)]) continue;
      for (const [name, token] of Object.entries(tokens)) {
        const res = await r.app.inject({
          method: r.method as any,
          url: fill(r.url),
          headers: { authorization: `Bearer ${token}` },
          payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
        });
        if (res.statusCode !== 401) leaks.push(`${key(r)} [${name}] -> ${res.statusCode}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('public routes never crash on empty or junk input', async () => {
    const crashes: string[] = [];
    for (const r of routes) {
      if (!PUBLIC[key(r)]) continue;
      for (const payload of [undefined, {}, { username: { $gt: '' }, password: ['x'] }, { username: 'a', email: { $ne: 1 }, password: 12345678 }, 'not json']) {
        const res = await r.app.inject({ method: r.method as any, url: fill(r.url), payload: r.method === 'GET' ? undefined : (payload as any), headers: payload === 'not json' ? { 'content-type': 'application/json' } : {} });
        if (res.statusCode >= 500) crashes.push(`${key(r)} ${JSON.stringify(payload)} -> ${res.statusCode}`);
      }
    }
    expect(crashes).toEqual([]);
  });

  it('the public list only names routes that exist', () => {
    const existing = new Set(routes.map(key));
    expect(Object.keys(PUBLIC).filter((k) => !existing.has(k))).toEqual([]);
  });

  it('responses carry baseline security headers', async () => {
    const res = await api.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
