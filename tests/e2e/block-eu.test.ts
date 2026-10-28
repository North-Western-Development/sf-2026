import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { buildFileApp } from '../../apps/file-service/src/index.js';
import { createGatewayServer, GatewayResolver } from '../../apps/gateway-service/src/index.js';
import { signAccessToken, getJwtSecret, hashPassword } from '@subspace/crypto';
import { transmitters, eq } from '@subspace/database';

/** BLOCK_EU: refused addresses (every service), sign-up and account emails, and phone numbers. */
describe('BLOCK_EU', () => {
  const SECRET = getJwtSecret();
  const GATEWAY_PORT = 3998;
  let app: FastifyInstance;
  let fileApp: FastifyInstance;
  let gateway: ReturnType<typeof createGatewayServer>;
  let db: any;
  let dir: string;
  const pilot = { id: '801756946623497001', username: 'beu_pilot' };
  const PASSWORD = 'correct horse battery';
  const auth = { authorization: `Bearer ${signAccessToken({ transmitterId: pilot.id, username: pilot.username, staffRank: 0 }, SECRET)}` };
  // Documentation ranges stand in for the EU ones.
  const EU_V4 = '203.0.113.7';
  const EU_V6 = '2001:db8::7';
  const ELSEWHERE = '198.51.100.7';

  const resolver: GatewayResolver = {
    getPresencePeers: async () => [],
    getBeaconIds: async () => [],
    authorizeVoice: async () => null,
    authorizeCall: async () => null,
    finishCall: async () => {},
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block-eu-'));
    fs.writeFileSync(path.join(dir, 'ranges.csv'), '203.0.113.0,203.0.113.255,DE\n2001:db8::,2001:db8:ffff:ffff:ffff:ffff:ffff:ffff,FR\n');
    process.env.BLOCK_EU_RANGES = path.join(dir, 'ranges.csv');
    process.env.BLOCK_EU = 'true';
    app = await buildApp();
    await app.ready();
    fileApp = await buildFileApp();
    await fileApp.ready();
    gateway = createGatewayServer(GATEWAY_PORT, { redis: false, resolver });
    db = (app as any).db;
    if (!db) return;
    await db.delete(transmitters).where(eq(transmitters.id, pilot.id));
    await db.insert(transmitters).values({
      id: pilot.id,
      username: pilot.username,
      email: `${pilot.username}@subspace.test`,
      passwordHash: await hashPassword(PASSWORD),
      displayName: pilot.username,
      isEmailVerified: true,
    });
  });

  afterAll(async () => {
    delete process.env.BLOCK_EU;
    delete process.env.BLOCK_EU_RANGES;
    if (db) await db.delete(transmitters).where(eq(transmitters.id, pilot.id));
    await gateway?.close();
    await fileApp?.close();
    await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('answers 401 REGION_BLOCKED to refused addresses on every route, public or not', async () => {
    for (const ip of [EU_V4, EU_V6, `::ffff:${EU_V4}`]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/system/info', remoteAddress: ip });
      expect(res.statusCode, ip).toBe(401);
      expect(res.json()).toMatchObject({ code: 'REGION_BLOCKED' });
      // The browser drops this site's cookies.
      expect(res.headers['clear-site-data']).toBe('"cookies"');
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/system/info', remoteAddress: ELSEWHERE })).statusCode).toBe(200);
    // Signed in makes no difference.
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth, remoteAddress: EU_V4 })).json().code).toBe('REGION_BLOCKED');
    // Behind nginx: the forwarded address counts, but only from the proxy itself.
    const proxied = await app.inject({ method: 'GET', url: '/api/v1/system/info', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': EU_V4 } });
    expect(proxied.statusCode).toBe(401);
    const spoofed = await app.inject({ method: 'GET', url: '/api/v1/system/info', remoteAddress: EU_V4, headers: { 'x-forwarded-for': ELSEWHERE } });
    expect(spoofed.statusCode).toBe(401);

    const files = await fileApp.inject({ method: 'GET', url: '/api/v1/vault/files', remoteAddress: EU_V4 });
    expect(files.statusCode).toBe(401);
    expect(files.json()).toMatchObject({ code: 'REGION_BLOCKED' });
    expect(files.headers['clear-site-data']).toBe('"cookies"');
  });

  it('refuses gateway connections from refused addresses', async () => {
    const status = (headers: Record<string, string>) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${GATEWAY_PORT}`, { headers });
        ws.on('open', () => {
          ws.close();
          resolve(101);
        });
        ws.on('unexpected-response', (_req, res) => {
          if (res.statusCode === 401) expect(res.headers['clear-site-data']).toBe('"cookies"');
          resolve(res.statusCode ?? 0);
        });
        ws.on('error', () => {});
      });
    expect(await status({ 'x-forwarded-for': EU_V4 })).toBe(401);
    expect(await status({ 'x-forwarded-for': ELSEWHERE })).toBe(101);
  });

  it('refuses sign-up and email changes to EU, EEA and UK email domains', async () => {
    for (const email of ['someone@example.de', 'someone@mail.co.uk', 'someone@gmx.net', 'someone@example.eu']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: ELSEWHERE,
        payload: { username: 'beu_new', email, password: PASSWORD, acceptDirectives: true },
      });
      expect(res.json().code, email).toBe('EMAIL_REGION_BLOCKED');
    }
    if (db) {
      const change = await app.inject({ method: 'PATCH', url: '/api/v1/auth/me/email', headers: auth, remoteAddress: ELSEWHERE, payload: { email: 'pilot@example.fr', password: PASSWORD } });
      expect(change.statusCode).toBe(400);
      expect(change.json().code).toBe('EMAIL_REGION_BLOCKED');
    }
  });

  it('refuses to verify EU, EEA and UK phone numbers', async () => {
    if (!db) return;
    for (const phone of ['+4915112345678', '+447700900123', '+33612345678', '+4791234567']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/users/@me/phone', headers: auth, remoteAddress: ELSEWHERE, payload: { phone, password: PASSWORD } });
      expect(res.statusCode, phone).toBe(400);
      expect(res.json()).toMatchObject({ code: 'PHONE_COUNTRY_BLOCKED', error: expect.stringContaining('EU') });
    }
  });

  it('does nothing when BLOCK_EU is off', async () => {
    process.env.BLOCK_EU = 'false';
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v1/system/info', remoteAddress: EU_V4 })).statusCode).toBe(200);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: ELSEWHERE,
        // An invalid username: the request gets past the email check and stops at the next one.
        payload: { username: 'Not Valid!', email: 'someone@example.de', password: PASSWORD, acceptDirectives: true },
      });
      expect(res.json().code).toBe('INVALID_USERNAME');
    } finally {
      process.env.BLOCK_EU = 'true';
    }
  });
});
