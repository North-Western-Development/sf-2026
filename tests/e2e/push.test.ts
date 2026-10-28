import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { closeApns } from '../../apps/api-service/src/lib/apns.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, pointToPointLinks, pushTokens, affiliations, notificationSettings, eq, or } from '@subspace/database';
import { pushText } from '../../apps/api-service/src/modules/messaging/messaging.routes.js';

/** What a phone does with a UnifiedPush message: decrypt it (RFC 8291) with its own keys. */
function decrypt(body: Buffer, receiver: crypto.ECDH, authSecret: Buffer): any {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const senderPublic = body.subarray(21, 21 + idLen);
  const hmac = (k: Buffer, d: Buffer) => crypto.createHmac('sha256', k).update(d).digest();
  const expand = (prk: Buffer, info: string | Buffer, n: number) => hmac(prk, Buffer.concat([Buffer.from(info as any), Buffer.from([1])])).subarray(0, n);
  const shared = receiver.computeSecret(senderPublic);
  const ikm = expand(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderPublic]), 32);
  const prk = hmac(salt, ikm);
  const decipher = crypto.createDecipheriv('aes-128-gcm', expand(prk, 'Content-Encoding: aes128gcm\0', 16), expand(prk, 'Content-Encoding: nonce\0', 12));
  const data = body.subarray(21 + idLen);
  decipher.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return JSON.parse(plain.subarray(0, -1).toString());
}

/** Mobile push straight to APNs (a mock HTTP/2 server) and to UnifiedPush endpoints (a mock distributor). */
describe('Mobile push notifications', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let apns: http2.Http2Server;
  let distributor: http.Server;
  let apnsGot: Array<{ path: string; headers: any; body: any }> = [];
  let upGot: Array<{ path: string; headers: any; body: Buffer }> = [];
  let apnsReply: () => [number, object | null] = () => [200, null];
  let upStatus = 201;
  const apnsKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const phone = crypto.createECDH('prime256v1');
  phone.generateKeys();
  const phoneAuth = crypto.randomBytes(16);
  const alice = { id: '622426643673907201', username: 'push_alice' };
  const bob = { id: '622426643673907202', username: 'push_bob' };
  const tok = (u: typeof alice) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const call = (method: string, url: string, u: typeof alice, payload?: unknown) => app.inject({ method: method as any, url, headers: { authorization: `Bearer ${tok(u)}` }, payload: payload as any });
  const IPHONE = 'ab'.repeat(32);
  let endpoint = '';
  let linkId = '';
  const env: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => {
    if (!(k in env)) env[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 30));
  };
  const registerBoth = async () => {
    expect((await call('POST', '/api/v1/push/tokens', bob, { kind: 'apns', token: IPHONE })).statusCode).toBe(204);
    const up = await call('POST', '/api/v1/push/tokens', bob, { kind: 'unifiedpush', endpoint, p256dh: phone.getPublicKey().toString('base64url'), auth: phoneAuth.toString('base64url') });
    expect(up.statusCode, up.body).toBe(204);
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    apns = http2.createServer();
    apns.on('stream', (stream, headers) => {
      let body = '';
      stream.on('data', (c) => (body += c));
      stream.on('end', () => {
        apnsGot.push({ path: String(headers[':path']), headers, body: JSON.parse(body) });
        const [status, json] = apnsReply();
        stream.respond({ ':status': status });
        stream.end(json ? JSON.stringify(json) : undefined);
      });
    });
    await new Promise<void>((r) => apns.listen(0, '127.0.0.1', r));
    distributor = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        upGot.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(upStatus);
        res.end();
      });
    });
    await new Promise<void>((r) => distributor.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(distributor.address() as AddressInfo).port}/upAbCdEf123456?up=1`;
    setEnv('APNS_URL', `http://127.0.0.1:${(apns.address() as AddressInfo).port}`);
    setEnv('APNS_KEY', apnsKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    setEnv('APNS_KEY_FILE', undefined);
    setEnv('APNS_KEY_ID', 'KEY1234567');
    setEnv('APNS_TEAM_ID', 'TEAM123456');
    setEnv('UNIFIEDPUSH_SERVER', 'https://push.example.test');
    setEnv('UNFURL_ALLOW_PRIVATE_HOSTS', '127.0.0.1');
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    const ids = [alice.id, bob.id];
    await db.delete(pointToPointLinks).where(or(...ids.map((id) => eq(pointToPointLinks.transmitter1Id, id))));
    await db.delete(affiliations).where(or(...ids.map((id) => eq(affiliations.transmitterId, id))));
    await db.delete(pushTokens).where(or(...ids.map((id) => eq(pushTokens.transmitterId, id))));
    await db.delete(notificationSettings).where(eq(notificationSettings.transmitterId, bob.id));
    for (const u of [alice, bob]) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (!existing.length) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username === 'push_alice' ? 'Alice Nova' : 'Bob' });
    }
    linkId = (await db.insert(pointToPointLinks).values({ transmitter1Id: alice.id, transmitter2Id: bob.id }).returning())[0].id;
    // Affiliates, so the DM is allowed without a shared beacon.
    await db.insert(affiliations).values({ transmitterId: alice.id, targetId: bob.id, status: 'accepted' });
    await (app as any).redis?.hdel('presence', bob.id);
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    closeApns();
    await app.close();
    apns.close();
    distributor.close();
  });

  it('says which push it can send, signed out', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/push/config' });
    expect(res.json()).toEqual({ apns: true, unifiedpush: true, ntfy: 'https://push.example.test' });
  });

  it('accepts only APNs tokens and UnifiedPush endpoints with valid keys', async () => {
    if (!db) return;
    const keys = { p256dh: phone.getPublicKey().toString('base64url'), auth: phoneAuth.toString('base64url') };
    for (const bad of [
      { token: 'ExponentPushToken[bob-phone-123456]' },
      { kind: 'apns', token: 'not-hex' },
      { kind: 'unifiedpush', endpoint, p256dh: keys.p256dh },
      { kind: 'unifiedpush', endpoint, p256dh: 'A'.repeat(87), auth: keys.auth },
      { kind: 'unifiedpush', endpoint: 'ftp://push.example.com/up1', ...keys },
      { kind: 'unifiedpush', endpoint: 'http://push.example.com/up1', ...keys },
      // Private and loopback hosts are refused (only this test allow-lists 127.0.0.1).
      { kind: 'unifiedpush', endpoint: 'https://10.0.0.5/up1', ...keys },
      { kind: 'unifiedpush', endpoint: 'https://user:pw@push.example.com/up1', ...keys },
    ]) {
      expect((await call('POST', '/api/v1/push/tokens', bob, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    await registerBoth();
  });

  it('pushes a direct-link message: readable and encrypted for Android, content-free for Apple', async () => {
    if (!db) return;
    apnsGot = [];
    upGot = [];
    await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: `**hey** <@${bob.id}> check ||the secret||` });
    await settle();

    expect(apnsGot).toHaveLength(1);
    expect(apnsGot[0].path).toBe(`/3/device/${IPHONE}`);
    expect(apnsGot[0].headers['apns-topic']).toBe('click.subspace.mobile');
    expect(apnsGot[0].headers['apns-push-type']).toBe('alert');
    expect(apnsGot[0].body).toEqual({ aps: { alert: { title: 'New transmission' }, sound: 'default' }, path: `/channels/@me/${linkId}` });
    // Signed with the operator's key: a provider token Apple can verify.
    const [h, p, s] = String(apnsGot[0].headers.authorization).replace(/^bearer /, '').split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString()).iss).toBe('TEAM123456');
    expect(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: apnsKey.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
    // Nothing readable for Apple.
    expect(JSON.stringify(apnsGot[0].body)).not.toMatch(/Alice|hey/);

    expect(upGot).toHaveLength(1);
    expect(upGot[0].path).toBe('/upAbCdEf123456?up=1');
    expect(upGot[0].headers['content-encoding']).toBe('aes128gcm');
    expect(upGot[0].body.toString('latin1')).not.toMatch(/Alice|hey/);
    expect(decrypt(upGot[0].body, phone, phoneAuth)).toEqual({ kind: 'message', title: 'Alice Nova', body: 'hey @someone check [spoiler]', path: `/channels/@me/${linkId}` });
  });

  it('stays quiet for a muted conversation or Do Not Disturb', async () => {
    if (!db) return;
    await db.insert(notificationSettings).values({ transmitterId: bob.id, scopeType: 'link', scopeId: linkId, mutedUntil: new Date(Date.now() + 3600_000) });
    apnsGot = [];
    upGot = [];
    await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'muted?' });
    await settle();
    expect([...apnsGot, ...upGot]).toEqual([]);
    await db.delete(notificationSettings).where(eq(notificationSettings.transmitterId, bob.id));

    await (app as any).redis?.hset('presence', bob.id, 'dnd');
    await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'dnd?' });
    await settle();
    expect([...apnsGot, ...upGot]).toEqual([]);
    await (app as any).redis?.hdel('presence', bob.id);
  });

  it('forgets tokens and endpoints that are gone', async () => {
    if (!db) return;
    apnsReply = () => [410, { reason: 'Unregistered' }];
    upStatus = 404;
    await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'anyone there?' });
    await settle();
    expect(await db.select().from(pushTokens).where(eq(pushTokens.transmitterId, bob.id))).toEqual([]);
    apnsReply = () => [200, null];
    upStatus = 201;
  });

  it('without an Apple key, iOS push is unavailable and nothing goes to Apple', async () => {
    if (!db) return;
    await registerBoth();
    setEnv('APNS_KEY', undefined);
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v1/push/config' })).json().apns).toBe(false);
      expect((await call('POST', '/api/v1/push/tokens', bob, { kind: 'apns', token: 'cd'.repeat(32) })).statusCode).toBe(409);
      apnsGot = [];
      upGot = [];
      await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'android only' });
      await settle();
      expect(apnsGot).toEqual([]);
      expect(upGot).toHaveLength(1);
    } finally {
      setEnv('APNS_KEY', apnsKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    }
  });

  it('keeps at most ten installs an account', async () => {
    if (!db) return;
    for (let i = 0; i < 12; i++) await call('POST', '/api/v1/push/tokens', bob, { kind: 'apns', token: i.toString(16).padStart(64, 'e') });
    const rows = await db.select().from(pushTokens).where(eq(pushTokens.transmitterId, bob.id));
    expect(rows).toHaveLength(10);
    // The newest stay.
    expect(rows.map((r: any) => r.token)).toContain((11).toString(16).padStart(64, 'e'));
    await db.delete(pushTokens).where(eq(pushTokens.transmitterId, bob.id));
  });

  it('removes a token only for its owner', async () => {
    if (!db) return;
    await call('POST', '/api/v1/push/tokens', bob, { kind: 'apns', token: IPHONE });
    await call('POST', '/api/v1/push/tokens/remove', alice, { token: IPHONE });
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, IPHONE))).toHaveLength(1);
    await call('POST', '/api/v1/push/tokens/remove', bob, { token: IPHONE.toUpperCase() });
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, IPHONE))).toEqual([]);
  });

  it('turns markup into plain preview text', () => {
    expect(pushText('> quote `code` ~~x~~ <#978275694148452353> <a:wave:978275694148452354>')).toBe('quote code x #relay :wave:');
  });
});
