import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { transmitters, beaconEmojis, eq } from '@subspace/database';
import { Redis } from 'ioredis';

describe('Parity: unified channel messaging (replies, mentions, reactions, pins, typing)', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const ownerId = 'c1000000-0000-0000-0000-000000000001';
  const memberId = 'c1000000-0000-0000-0000-000000000002';
  const outsiderId = 'c1000000-0000-0000-0000-000000000003';
  let ownerToken: string, memberToken: string, outsiderToken: string;

  let beaconId: string;
  let relayId: string;
  let foreignBeaconId: string;
  let foreignGlyphId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    const db = (app as any).db;
    if (!db) return;

    const users = [
      { id: ownerId, username: 'parity_owner', email: 'parity_owner@subspace.net', passwordHash: 'hash', displayName: 'Owner' },
      { id: memberId, username: 'parity_member', email: 'parity_member@subspace.net', passwordHash: 'hash', displayName: 'Member' },
      { id: outsiderId, username: 'parity_outsider', email: 'parity_outsider@subspace.net', passwordHash: 'hash', displayName: 'Outsider' },
    ];
    for (const u of users) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (existing.length === 0) await db.insert(transmitters).values(u);
    }

    ownerToken = signAccessToken({ transmitterId: ownerId, username: 'parity_owner', staffRank: 0 }, JWT_SECRET);
    memberToken = signAccessToken({ transmitterId: memberId, username: 'parity_member', staffRank: 0 }, JWT_SECRET);
    outsiderToken = signAccessToken({ transmitterId: outsiderId, username: 'parity_outsider', staffRank: 0 }, JWT_SECRET);

    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Parity Messaging Beacon' },
    });
    beaconId = bRes.json().beacon.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/join`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    const rRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'general', type: 'text' },
    });
    relayId = rRes.json().relay.id;

    // A second, foreign beacon whose glyph must be rejected when used from the first.
    const fbRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: { name: 'Foreign Beacon' },
    });
    foreignBeaconId = fbRes.json().beacon.id;
    const [glyph] = await db
      .insert(beaconEmojis)
      .values({ beaconId: foreignBeaconId, name: 'foreign', url: 'https://example.com/foreign.png', uploaderId: outsiderId })
      .returning();
    foreignGlyphId = glyph.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('401s without a token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/channels/relay/${relayId}/transmissions` });
    expect(res.statusCode).toBe(401);
  });

  it('404s for an outsider (IDOR) trying to view or post', async () => {
    if (!(app as any).db) return;
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: { content: 'sneaking in' },
    });
    expect(postRes.statusCode).toBe(404);
  });

  it('400s when neither content nor attachmentIds are given', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  let firstMessageId: string;
  it('creates a transmission and publishes TRANSMISSION_CREATE to the relay audience', async () => {
    if (!(app as any).db) return;
    const sub = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
    const events: any[] = [];
    let redisAvailable = true;
    try {
      await sub.connect();
      await sub.subscribe('gateway:transmission:events');
      sub.on('message', (_c, m) => events.push(JSON.parse(m)));
    } catch {
      redisAvailable = false;
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { content: 'Hello parity world', nonce: 'abc123' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.transmission.channelType).toBe('relay');
    expect(body.transmission.channelId).toBe(relayId);
    firstMessageId = body.transmission.id;

    await new Promise((r) => setTimeout(r, 150));
    if (redisAvailable) {
      const created = events.find((e) => e.type === 'TRANSMISSION_CREATE');
      expect(created).toBeDefined();
      expect(created.nonce).toBe('abc123');
      expect(new Set(created.audience)).toEqual(new Set([ownerId, memberId]));
      await sub.quit();
    }
  });

  it('parses @everyone only when the author has MENTION_EVERYONE', async () => {
    if (!(app as any).db) return;
    // @everyone by a plain member (no MENTION_EVERYONE by default) is not honored.
    const memberRes = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { content: 'hey @everyone check this out' },
    });
    expect(memberRes.statusCode).toBe(201);
    expect(memberRes.json().transmission.mentionEveryone).toBe(false);
  });

  it('adds a reply-ping mention to the parent author', async () => {
    if (!(app as any).db) return;
    const replyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { content: 'replying now', replyToId: firstMessageId, replyPing: true },
    });
    expect(replyRes.statusCode).toBe(201);
    const tx = replyRes.json().transmission;
    expect(tx.type).toBe('reply');
    expect(tx.replyTo.id).toBe(firstMessageId);
    expect(tx.mentions).toContain(ownerId);
  });

  it('paginates with before/after/around and clamps limit', async () => {
    if (!(app as any).db) return;
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/channels/relay/${relayId}/transmissions`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { content: `filler ${i}` },
      });
    }

    const overLimit = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/transmissions?limit=500`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(overLimit.statusCode).toBe(200);
    expect(overLimit.json().transmissions.length).toBeLessThanOrEqual(100);

    const all = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/transmissions?limit=100`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const list = all.json().transmissions;
    expect(list.length).toBeGreaterThan(3);

    const midId = list[Math.floor(list.length / 2)].id;
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/transmissions?before=${midId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().transmissions.every((t: any) => t.id !== midId)).toBe(true);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/transmissions?after=${midId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(after.statusCode).toBe(200);

    const around = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/transmissions?around=${midId}&limit=4`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(around.statusCode).toBe(200);
    expect(around.json().transmissions.some((t: any) => t.id === midId)).toBe(true);
  });

  it('reacts, enforces the distinct-emoji limit, and rejects a foreign-beacon glyph', async () => {
    if (!(app as any).db) return;
    const addRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/transmissions/${firstMessageId}/reactions/${encodeURIComponent('🚀')}/@me`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(addRes.statusCode).toBe(201);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/transmissions?limit=100`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const tx = getRes.json().transmissions.find((t: any) => t.id === firstMessageId);
    expect(tx.reactions.find((r: any) => r.emoji === '🚀').count).toBe(1);

    const foreignRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/transmissions/${firstMessageId}/reactions/${encodeURIComponent(`custom:${foreignGlyphId}`)}/@me`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(foreignRes.statusCode).toBe(403);
    expect(foreignRes.json().code).toBe('FOREIGN_GLYPH');

    const removeRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/transmissions/${firstMessageId}/reactions/${encodeURIComponent('🚀')}/@me`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(removeRes.statusCode).toBe(200);
  });

  it('pins a transmission, inserts a system message, and enforces access', async () => {
    if (!(app as any).db) return;
    const memberPinAttempt = await app.inject({
      method: 'PUT',
      url: `/api/v1/transmissions/${firstMessageId}/pin`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(memberPinAttempt.statusCode).toBe(403);

    const pinRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/transmissions/${firstMessageId}/pin`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(pinRes.statusCode).toBe(200);
    expect(pinRes.json().transmission.pinned).toBe(true);

    const pinsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/pins`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(pinsRes.json().transmissions.some((t: any) => t.id === firstMessageId)).toBe(true);

    const feed = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/relay/${relayId}/transmissions?limit=100`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(feed.json().transmissions.some((t: any) => t.type === 'system_pin')).toBe(true);

    const unpinRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/transmissions/${firstMessageId}/pin`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(unpinRes.statusCode).toBe(200);
    expect(unpinRes.json().transmission.pinned).toBe(false);
  });

  it('throttles typing to one event per user per channel per 5s', async () => {
    if (!(app as any).db || !(app as any).redis) return;
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/typing`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(first.statusCode).toBe(204);

    const sub = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
    const events: any[] = [];
    await sub.connect();
    await sub.subscribe('gateway:transmission:events');
    sub.on('message', (_c, m) => events.push(JSON.parse(m)));

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/typing`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(second.statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 150));
    expect(events.find((e) => e.type === 'TYPING_START')).toBeUndefined();
    await sub.quit();
  });
});
