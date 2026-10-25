import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, accountConnections, eq, or } from '@subspace/database';
import { startMockDrives, type MockDrives } from '../support/mock-drives.js';

/** Connections: the real sign-in flows against the mock providers, then the profile. */
describe('Connections', () => {
  const SECRET = getJwtSecret();
  const ORIGIN = 'http://localhost:4173';
  let app: FastifyInstance;
  let db: any;
  let mock: MockDrives;
  const pilot = { id: 'fe300000-0000-4000-8000-000000000001', username: 'conn_pilot' };
  const viewer = { id: 'fe300000-0000-4000-8000-000000000002', username: 'conn_viewer' };
  const tok = (u: typeof pilot) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const inject = (method: string, url: string, user?: typeof pilot, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: method as any, url, payload: payload as any, headers: { ...(user ? { authorization: `Bearer ${tok(user)}` } : {}), ...headers } });
  const saved: Record<string, string | undefined> = {};
  const KEYS = ['DRIVE_MOCK_ORIGIN', 'CONNECTIONS_MOCK_ORIGIN', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_ORIGIN', 'DRIVE_REDIRECT_BASE', 'CONNECTIONS_REDIRECT_BASE', 'STEAM_API_KEY'];

  /** Start, let the mock sign in, and land on the callback the popup would. */
  async function connect(provider: string, { cookie: useCookie = true } = {}) {
    const start = await inject('POST', `/api/v1/users/@me/connections/${provider}/authorize`, pilot, {}, { origin: ORIGIN });
    expect(start.statusCode, start.body).toBe(200);
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    const res = await fetch(start.json().url, { redirect: 'manual' });
    const callback = new URL(res.headers.get('location')!);
    expect(callback.origin + callback.pathname).toBe(`${ORIGIN}/api/v1/connections/${provider}/callback`);
    return inject('GET', callback.pathname + callback.search, undefined, undefined, useCookie ? { cookie } : {});
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    mock = await startMockDrives();
    for (const k of KEYS) saved[k] = process.env[k];
    Object.assign(process.env, { CONNECTIONS_MOCK_ORIGIN: mock.origin, GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret', GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret' });
    for (const k of ['PUBLIC_ORIGIN', 'DRIVE_REDIRECT_BASE', 'CONNECTIONS_REDIRECT_BASE', 'STEAM_API_KEY']) delete process.env[k];
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(transmitters).where(or(eq(transmitters.id, pilot.id), eq(transmitters.id, viewer.id)));
    for (const u of [pilot, viewer]) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true });
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    if (db) await db.delete(transmitters).where(or(eq(transmitters.id, pilot.id), eq(transmitters.id, viewer.id)));
    await app.close();
    await mock.close();
  });

  it('offers the configured providers and links GitHub, Google and Steam', async () => {
    if (!db) return;
    const list = (await inject('GET', '/api/v1/users/@me/connections', pilot)).json();
    expect(list.connections).toEqual([]);
    const available = Object.fromEntries(list.providers.map((p: any) => [p.provider, p.available]));
    expect(available).toMatchObject({ github: true, google: true, steam: true });

    for (const p of ['github', 'google', 'steam']) {
      const done = await connect(p);
      expect(done.statusCode, done.body).toBe(200);
      expect(done.body).toContain('"ok":true');
    }
    const after = (await inject('GET', '/api/v1/users/@me/connections', pilot)).json().connections;
    expect(after.map((c: any) => [c.provider, c.name, c.url])).toEqual([
      ['github', 'pilot-gh', 'https://github.com/pilot-gh'],
      ['google', 'Pilot Google', null],
      ['steam', '76561198000004242', 'https://steamcommunity.com/profiles/76561198000004242'],
    ]);
    // Connecting the same account again updates it rather than adding another.
    await connect('github');
    expect((await inject('GET', '/api/v1/users/@me/connections', pilot)).json().connections).toHaveLength(3);
    // Nothing secret is kept.
    const [row] = await db.select().from(accountConnections).where(eq(accountConnections.provider, 'github'));
    expect(JSON.stringify(row)).not.toContain('access');
  });

  it('refuses a callback from another browser or with a forged state', async () => {
    if (!db) return;
    const stolen = await connect('github', { cookie: false });
    expect(stolen.statusCode).toBe(400);
    const forged = await inject('GET', '/api/v1/connections/github/callback?code=x&state=nope', undefined, undefined, { cookie: 'subspace_connection_oauth=abc' });
    expect(forged.statusCode).toBe(400);
    // Steam's assertion must be one Steam itself confirms.
    const start = await inject('POST', '/api/v1/users/@me/connections/steam/authorize', pilot, {}, { origin: ORIGIN });
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    const back = new URL(String((await fetch(start.json().url, { redirect: 'manual' })).headers.get('location')));
    back.searchParams.set('openid.sig', 'tampered');
    expect((await inject('GET', back.pathname + back.search, undefined, undefined, { cookie })).statusCode).toBe(400);
  });

  it('shows visible connections on the profile, hides hidden ones, and removes them', async () => {
    if (!db) return;
    const mine = (await inject('GET', '/api/v1/users/@me/connections', pilot)).json().connections;
    const google = mine.find((c: any) => c.provider === 'google');
    const shown = (await inject('GET', `/api/v1/users/${pilot.id}/profile`, viewer)).json().connections;
    expect(shown.map((c: any) => c.provider)).toEqual(['github', 'google', 'steam']);
    await inject('PATCH', `/api/v1/users/@me/connections/${google.id}`, pilot, { visible: false });
    expect((await inject('GET', `/api/v1/users/${pilot.id}/profile`, viewer)).json().connections.map((c: any) => c.provider)).toEqual(['github', 'steam']);
    // Someone else cannot touch them.
    expect((await inject('PATCH', `/api/v1/users/@me/connections/${google.id}`, viewer, { visible: true })).statusCode).toBe(404);
    await inject('DELETE', `/api/v1/users/@me/connections/${google.id}`, viewer);
    expect((await inject('GET', '/api/v1/users/@me/connections', pilot)).json().connections).toHaveLength(3);
    expect((await inject('DELETE', `/api/v1/users/@me/connections/${google.id}`, pilot)).statusCode).toBe(204);
    expect((await inject('GET', '/api/v1/users/@me/connections', pilot)).json().connections).toHaveLength(2);
  });
});
