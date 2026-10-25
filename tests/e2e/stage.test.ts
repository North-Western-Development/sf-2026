import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, eq, or } from '@subspace/database';

/** Stages: audience tokens, going live, Request to Speak, speakers, and events in a Stage. */
describe('Stages', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let redis: any;
  const host = { id: 'fe500000-0000-4000-8000-000000000001', username: 'stage_host' };
  const fan = { id: 'fe500000-0000-4000-8000-000000000002', username: 'stage_fan' };
  const users = [host, fan];
  const auth = (u: typeof host) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: typeof host, payload?: unknown) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  const inStage = (u: typeof host, relayId: string | null) => (relayId ? redis.hset('voice:relay', u.id, relayId) : redis.hdel('voice:relay', u.id));
  /** What the LiveKit token lets them publish. */
  const grant = async (u: typeof host) => {
    const res = (await call('POST', `/relays/${stageId}/comm-link/token`, u)).json();
    const video = JSON.parse(Buffer.from(res.token.split('.')[1], 'base64url').toString()).video;
    return { canSpeak: res.canSpeak, canPublish: video.canPublish };
  };
  let beaconId = '';
  let stageId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    redis = (app as any).redis;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, host.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true, createdAt: new Date(Date.now() - 30 * 86_400_000) });
    beaconId = (await call('POST', '/beacons', host, { name: 'Talk Night', isDiscoverable: true })).json().beacon.id;
    stageId = (await call('POST', `/beacons/${beaconId}/relays`, host, { name: 'Main Stage', type: 'stage' })).json().relay.id;
    await call('POST', `/beacons/${beaconId}/join`, fan);
  });

  afterAll(async () => {
    if (db) {
      for (const u of users) await redis?.hdel('voice:relay', u.id);
      await redis?.del(`stage:${stageId}`);
      await db.delete(beacons).where(eq(beacons.ownerId, host.id));
      await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    }
    await app.close();
  });

  it('lets everyone in as the audience until a moderator goes live and invites them up', async () => {
    if (!db || !redis) return;
    expect(await grant(fan)).toEqual({ canSpeak: false, canPublish: false });
    expect(await grant(host)).toEqual({ canSpeak: false, canPublish: false });
    const empty = (await call('GET', `/relays/${stageId}/stage`, fan)).json();
    expect(empty).toMatchObject({ stage: { startedAt: null, speakers: [] }, moderator: false });
    expect((await call('GET', `/relays/${stageId}/stage`, host)).json().moderator).toBe(true);

    await inStage(host, stageId);
    await inStage(fan, stageId);
    expect((await call('POST', `/relays/${stageId}/stage`, fan, { topic: 'Mine' })).json().code).toBe('NOT_STAGE_MODERATOR');
    expect((await call('POST', `/relays/${stageId}/stage/hand`, fan, { raised: true })).json().code).toBe('STAGE_NOT_LIVE');
    const live = (await call('POST', `/relays/${stageId}/stage`, host, { topic: 'Ask me anything' })).json().stage;
    expect(live).toMatchObject({ topic: 'Ask me anything', speakers: [host.id] });
    expect(await grant(host)).toEqual({ canSpeak: true, canPublish: true });

    // Request to Speak, then the moderator invites them up.
    expect((await call('POST', `/relays/${stageId}/stage/hand`, fan, { raised: true })).json().stage.requests).toEqual([fan.id]);
    expect((await call('PUT', `/relays/${stageId}/stage/speakers/${host.id}`, fan)).json().code).toBe('NOT_STAGE_MODERATOR');
    const up = (await call('PUT', `/relays/${stageId}/stage/speakers/${fan.id}`, host)).json().stage;
    expect(up).toMatchObject({ speakers: [host.id, fan.id], requests: [] });
    expect(await grant(fan)).toEqual({ canSpeak: true, canPublish: true });

    // Anyone can step down; only moderators move others.
    expect((await call('DELETE', `/relays/${stageId}/stage/speakers/${host.id}`, fan)).json().code).toBe('NOT_STAGE_MODERATOR');
    expect((await call('DELETE', `/relays/${stageId}/stage/speakers/${fan.id}`, fan)).json().stage.speakers).toEqual([host.id]);

    // Leaving the stage takes you off it.
    await inStage(host, null);
    expect((await call('GET', `/relays/${stageId}/stage`, fan)).json().stage.speakers).toEqual([]);
    await inStage(host, stageId);

    expect((await call('PATCH', `/relays/${stageId}/stage`, host, { topic: 'Round two' })).json().stage.topic).toBe('Round two');
    await call('DELETE', `/relays/${stageId}/stage`, host);
    expect((await call('GET', `/relays/${stageId}/stage`, fan)).json().stage.startedAt).toBeNull();
    await inStage(host, null);
    await inStage(fan, null);
  });

  it('holds events in a Stage', async () => {
    if (!db) return;
    const startAt = new Date(Date.now() + 86_400_000).toISOString();
    const text = (await call('GET', `/beacons/${beaconId}/relays`, host)).json().relays.find((r: any) => r.type === 'text');
    expect((await call('POST', `/beacons/${beaconId}/events`, host, { name: 'Wrong', locationType: 'stage', relayId: text.id, startAt })).statusCode).toBe(400);
    const ev = (await call('POST', `/beacons/${beaconId}/events`, host, { name: 'Town Hall', locationType: 'stage', relayId: stageId, startAt })).json().event;
    expect(ev).toMatchObject({ locationType: 'stage', relayId: stageId });
  });
});
