import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, eq, newSnowflake } from '@subspace/database';

/** What's New: the newest changelog entry seen, per platform, on the account. */
describe("What's New seen marks", () => {
  let app: FastifyInstance;
  const id = newSnowflake();
  let token = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    await (app as any).db.insert(transmitters).values({ id, username: `reader_${id.slice(-6)}`, email: `reader_${id}@subspace.net`, passwordHash: 'x', displayName: 'Reader' });
    token = signAccessToken({ transmitterId: id, username: 'reader', staffRank: 0 }, getJwtSecret());
  });
  afterAll(async () => {
    await (app as any).db.delete(transmitters).where(eq(transmitters.id, id));
    await app.close();
  });

  const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/v1/users/@me/changelog', headers: { authorization: `Bearer ${token}` }, payload: payload as any });

  it('starts empty and keeps one mark per platform', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json().transmitter?.changelogSeen ?? me.json().changelogSeen).toEqual({});

    expect((await put({ platform: 'web', seen: '2026-10-28' })).json().changelogSeen).toEqual({ web: '2026-10-28' });
    expect((await put({ platform: 'desktop', seen: '2026-10-28b' })).json().changelogSeen).toEqual({ web: '2026-10-28', desktop: '2026-10-28b' });
    expect((await put({ platform: 'web', seen: '2026-11-02' })).json().changelogSeen).toEqual({ web: '2026-11-02', desktop: '2026-10-28b' });
  });

  it('takes only known platforms and entry ids', async () => {
    expect((await put({ platform: 'toaster', seen: '2026-10-28' })).statusCode).toBe(400);
    expect((await put({ platform: 'web', seen: 'latest' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/users/@me/changelog', payload: { platform: 'web', seen: '2026-10-28' } })).statusCode).toBe(401);
  });
});
