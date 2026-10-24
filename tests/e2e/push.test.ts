import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, pointToPointLinks, pushTokens, affiliations, notificationSettings, eq, or } from '@subspace/database';
import { pushText } from '../../apps/api-service/src/modules/messaging/messaging.routes.js';

/** Mobile push via a mock of the Expo push service. */
describe('Mobile push notifications', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let expo: http.Server;
  let received: any[] = [];
  let reply: (batch: any[]) => any = (batch) => ({ data: batch.map(() => ({ status: 'ok', id: 'x' })) });
  const alice = { id: 'f8000000-0000-4000-8000-000000000001', username: 'push_alice' };
  const bob = { id: 'f8000000-0000-4000-8000-000000000002', username: 'push_bob' };
  const tok = (u: typeof alice) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const call = (method: string, url: string, u: typeof alice, payload?: unknown) => app.inject({ method: method as any, url, headers: { authorization: `Bearer ${tok(u)}` }, payload: payload as any });
  const TOKEN = 'ExponentPushToken[bob-phone-123456]';
  let linkId = '';
  let saved: string | undefined;
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 30));
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    expo = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const batch = JSON.parse(body);
        received.push(...batch);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply(batch)));
      });
    });
    await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
    saved = process.env.EXPO_PUSH_URL;
    process.env.EXPO_PUSH_URL = `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push`;
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    const ids = [alice.id, bob.id];
    await db.delete(pointToPointLinks).where(or(...ids.map((id) => eq(pointToPointLinks.transmitter1Id, id))));
    await db.delete(affiliations).where(or(...ids.map((id) => eq(affiliations.transmitterId, id))));
    await db.delete(pushTokens).where(eq(pushTokens.token, TOKEN));
    await db.delete(notificationSettings).where(eq(notificationSettings.transmitterId, bob.id));
    for (const u of [alice, bob]) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (!existing.length) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username === 'push_alice' ? 'Alice Nova' : 'Bob' });
    }
    linkId = (await db.insert(pointToPointLinks).values({ transmitter1Id: alice.id, transmitter2Id: bob.id }).returning())[0].id;
    await (app as any).redis?.hdel('presence', bob.id);
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env.EXPO_PUSH_URL;
    else process.env.EXPO_PUSH_URL = saved;
    await app.close();
    expo.close();
  });

  it('accepts only Expo push tokens', async () => {
    if (!db) return;
    expect((await call('POST', '/api/v1/push/tokens', bob, { token: 'not-a-token' })).statusCode).toBe(400);
    expect((await call('POST', '/api/v1/push/tokens', bob, { token: TOKEN, platform: 'android' })).statusCode).toBe(204);
  });

  it('pushes a direct-link message with readable text and where to open it', async () => {
    if (!db) return;
    received = [];
    await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: `**hey** <@${bob.id}> check ||the secret||` });
    await settle();
    expect(received).toEqual([{ to: TOKEN, title: 'Alice Nova', body: 'hey @someone check [spoiler]', data: { path: `/channels/@me/${linkId}` }, sound: 'default' }]);
    // Never to the sender.
    expect(received.every((m) => m.to === TOKEN)).toBe(true);
  });

  it('stays quiet for a muted conversation or Do Not Disturb', async () => {
    if (!db) return;
    await db.insert(notificationSettings).values({ transmitterId: bob.id, scopeType: 'link', scopeId: linkId, mutedUntil: new Date(Date.now() + 3600_000) });
    received = [];
    await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'muted?' });
    await settle();
    expect(received).toEqual([]);
    await db.delete(notificationSettings).where(eq(notificationSettings.transmitterId, bob.id));

    await (app as any).redis?.hset('presence', bob.id, 'dnd');
    await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'dnd?' });
    await settle();
    expect(received).toEqual([]);
    await (app as any).redis?.hdel('presence', bob.id);
  });

  it('forgets tokens Expo says are gone', async () => {
    if (!db) return;
    reply = (batch) => ({ data: batch.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })) });
    await call('POST', `/api/v1/channels/link/${linkId}/transmissions`, alice, { content: 'anyone there?' });
    await settle();
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, TOKEN))).toEqual([]);
  });

  it('removes a token only for its owner', async () => {
    if (!db) return;
    await call('POST', '/api/v1/push/tokens', bob, { token: TOKEN, platform: 'ios' });
    await call('POST', '/api/v1/push/tokens/remove', alice, { token: TOKEN });
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, TOKEN))).toHaveLength(1);
    await call('POST', '/api/v1/push/tokens/remove', bob, { token: TOKEN });
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, TOKEN))).toEqual([]);
  });

  it('turns markup into plain preview text', () => {
    expect(pushText('> quote `code` ~~x~~ <#00000000-0000-4000-8000-000000000001> <a:wave:00000000-0000-4000-8000-000000000002>')).toBe('quote code x #relay :wave:');
  });
});
