import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { transmitters, eq } from '@subspace/database';

describe('Parity: read state, unread mentions, notification settings', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const ownerId = 'd1000000-0000-0000-0000-000000000001';
  const memberId = 'd1000000-0000-0000-0000-000000000002';
  let ownerToken: string, memberToken: string;
  let beaconId: string, relayId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    const db = (app as any).db;
    if (!db) return;

    const users = [
      { id: ownerId, username: 'rs_owner', email: 'rs_owner@subspace.net', passwordHash: 'hash', displayName: 'Owner' },
      { id: memberId, username: 'rs_member', email: 'rs_member@subspace.net', passwordHash: 'hash', displayName: 'Member' },
    ];
    for (const u of users) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (existing.length === 0) await db.insert(transmitters).values(u);
    }
    ownerToken = signAccessToken({ transmitterId: ownerId, username: 'rs_owner', staffRank: 0 }, JWT_SECRET);
    memberToken = signAccessToken({ transmitterId: memberId, username: 'rs_member', staffRank: 0 }, JWT_SECRET);

    const bRes = await app.inject({ method: 'POST', url: '/api/v1/beacons', headers: { authorization: `Bearer ${ownerToken}` }, payload: { name: 'RS Beacon' } });
    beaconId = bRes.json().beacon.id;
    await app.inject({ method: 'POST', url: `/api/v1/beacons/${beaconId}/join`, headers: { authorization: `Bearer ${memberToken}` } });
    const rRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'general', type: 'text' },
    });
    relayId = rRes.json().relay.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('401s without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/read-states' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /read-states covers visible channels', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({ method: 'GET', url: '/api/v1/read-states', headers: { authorization: `Bearer ${memberToken}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.channels.some((c: any) => c.channelId === relayId)).toBe(true);
  });

  it('increments mention_count on a direct @mention and ack zeroes it', async () => {
    if (!(app as any).db) return;
    const msgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { content: `hi <@${memberId}>` },
    });
    expect(msgRes.statusCode).toBe(201);
    expect(msgRes.json().transmission.mentions).toContain(memberId);

    const rsRes = await app.inject({ method: 'GET', url: '/api/v1/read-states', headers: { authorization: `Bearer ${memberToken}` } });
    const relayState = rsRes.json().readStates.find((r: any) => r.channelId === relayId);
    expect(relayState.mentionCount).toBeGreaterThanOrEqual(1);

    const ackRes = await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/ack`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { transmissionId: msgRes.json().transmission.id },
    });
    expect(ackRes.statusCode).toBe(200);

    const rsAfter = await app.inject({ method: 'GET', url: '/api/v1/read-states', headers: { authorization: `Bearer ${memberToken}` } });
    const relayStateAfter = rsAfter.json().readStates.find((r: any) => r.channelId === relayId);
    expect(relayStateAfter.mentionCount).toBe(0);
  });

  it('does not increment mention_count for a plain (non-mention) message', async () => {
    if (!(app as any).db) return;
    await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/ack`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { transmissionId: (await app.inject({ method: 'GET', url: '/api/v1/read-states', headers: { authorization: `Bearer ${memberToken}` } })).json().channels.find((c: any) => c.channelId === relayId).lastTransmissionId },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { content: 'just chatting, no mentions here' },
    });

    const rsRes = await app.inject({ method: 'GET', url: '/api/v1/read-states', headers: { authorization: `Bearer ${memberToken}` } });
    const relayState = rsRes.json().readStates.find((r: any) => r.channelId === relayId);
    expect(relayState.mentionCount).toBe(0);
  });

  it('suppresses mention_count when the recipient sets notification level to nothing', async () => {
    if (!(app as any).db) return;
    const setRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/notification-settings/relay/${relayId}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { level: 'nothing' },
    });
    expect(setRes.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { content: `still there <@${memberId}>` },
    });

    const rsRes = await app.inject({ method: 'GET', url: '/api/v1/read-states', headers: { authorization: `Bearer ${memberToken}` } });
    const relayState = rsRes.json().readStates.find((r: any) => r.channelId === relayId);
    expect(relayState.mentionCount).toBe(0);

    // Reset back to inherit for later tests.
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/notification-settings/relay/${relayId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
  });

  it('suppresses mention_count for @everyone-only mentions when suppressEveryone is set', async () => {
    if (!(app as any).db) return;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/notification-settings/relay/${relayId}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { level: 'all', suppressEveryone: true },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { content: 'attention @everyone' },
    });

    const rsRes = await app.inject({ method: 'GET', url: '/api/v1/read-states', headers: { authorization: `Bearer ${memberToken}` } });
    const relayState = rsRes.json().readStates.find((r: any) => r.channelId === relayId);
    expect(relayState.mentionCount).toBe(0);
  });

  it('suppresses mention_count while muted', async () => {
    if (!(app as any).db) return;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/notification-settings/relay/${relayId}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { level: 'all', suppressEveryone: false, mutedUntil: 'infinity' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/channels/relay/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { content: `muted ping <@${memberId}>` },
    });

    const rsRes = await app.inject({ method: 'GET', url: '/api/v1/read-states', headers: { authorization: `Bearer ${memberToken}` } });
    const relayState = rsRes.json().readStates.find((r: any) => r.channelId === relayId);
    expect(relayState.mentionCount).toBe(0);
  });

  it('400s on invalid scopeType', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/notification-settings/not-a-scope/${relayId}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { level: 'all' },
    });
    expect(res.statusCode).toBe(400);
  });
});
