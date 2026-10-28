import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, transmissionRequests, pointToPointLinks, eq, or } from '@subspace/database';

/** Per-beacon Message Requests, and activities (Watch Together, Whiteboard) in comm-links. */
describe('Message requests and activities', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let redis: any;
  const host = { id: '358244887891017729', username: 'act_host' };
  const guest = { id: '358244887891017730', username: 'act_guest' };
  const shy = { id: '358244887891017731', username: 'act_shy' };
  const users = [host, guest, shy];
  const auth = (u: { id: string; username: string }) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: { id: string; username: string }, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  /** Stand in for the gateway: it records who is in which comm-link. */
  const inVoice = (u: { id: string }, relayId: string | null) => (relayId ? redis.hset('voice:relay', u.id, relayId) : redis.hdel('voice:relay', u.id));
  let beaconId = '';
  let commLink = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    redis = (app as any).redis;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, host.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) {
      await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true, createdAt: new Date(Date.now() - 30 * 86_400_000) });
    }
    beaconId = (await call('POST', '/beacons', host, { name: 'Hangout', isDiscoverable: true })).json().beacon.id;
    const relays = (await call('GET', `/beacons/${beaconId}/relays`, host)).json().relays;
    commLink = relays.find((r: any) => r.type === 'comm_link').id;
    await call('POST', `/beacons/${beaconId}/join`, guest);
    await call('POST', `/beacons/${beaconId}/join`, shy);
  });

  afterAll(async () => {
    if (db) {
      for (const u of users) await redis?.hdel('voice:relay', u.id);
      await db.delete(beacons).where(eq(beacons.ownerId, host.id));
      await db.delete(pointToPointLinks).where(or(...users.map((u) => eq(pointToPointLinks.transmitter1Id, u.id))));
      await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    }
    await app.close();
  });

  it('sends a first DM to Message Requests only where the recipient turned them on', async () => {
    if (!db) return;
    expect((await call('GET', `/beacons/${beaconId}/members/@me/privacy`, shy)).json().privacy).toMatchObject({ allowDms: true, messageRequests: false, shareActivity: true, activityJoining: true });
    const link = (await call('POST', '/links', guest, { targetId: shy.id })).json().link;
    // Off (the default): the DM goes straight through.
    expect((await call('POST', `/channels/link/${link.id}/transmissions`, guest, { content: 'hi there' })).statusCode).toBe(201);

    await call('PATCH', `/beacons/${beaconId}/members/@me`, shy, { messageRequests: true });
    const blocked = await call('POST', `/channels/link/${link.id}/transmissions`, guest, { content: 'again' });
    expect(blocked.json().code).toBe('MESSAGE_REQUEST_REQUIRED');
    const viaRequest = (await call('POST', `/links/${shy.id}/transmissions`, guest, { content: 'may I?' })).json();
    expect(viaRequest.isIntroductoryRequest).toBe(true);
    expect((await call('GET', '/requests', shy)).json().requests.map((r: any) => r.initialTransmission)).toContain('may I?');

    // Once they write back, it is a conversation and no longer a request.
    await db.delete(transmissionRequests).where(eq(transmissionRequests.senderId, guest.id));
    await call('PATCH', `/beacons/${beaconId}/members/@me`, shy, { messageRequests: false });
    expect((await call('POST', `/channels/link/${link.id}/transmissions`, shy, { content: 'sure' })).statusCode).toBe(201);
    await call('PATCH', `/beacons/${beaconId}/members/@me`, shy, { messageRequests: true });
    expect((await call('POST', `/channels/link/${link.id}/transmissions`, guest, { content: 'thanks' })).statusCode).toBe(201);
  });

  it('runs several activities at once, only for people in the comm-link, each ending when its last one leaves', async () => {
    if (!db || !redis) return;
    const acts = `/relays/${commLink}/activities`;
    expect((await call('POST', acts, host, { kind: 'whiteboard' })).json().code).toBe('NOT_IN_COMM_LINK');
    await inVoice(host, commLink);
    const started = (await call('POST', acts, host, { kind: 'whiteboard' })).json().activity;
    expect(started).toMatchObject({ kind: 'whiteboard', hostId: host.id, participants: [host.id] });

    // Outsiders see it, but cannot draw until they join from inside the comm-link.
    expect((await call('GET', acts, guest)).json().activities).toMatchObject([{ id: started.id, kind: 'whiteboard', count: 1 }]);
    expect((await call('POST', `${acts}/${started.id}/join`, guest)).json().code).toBe('NOT_IN_COMM_LINK');
    await inVoice(guest, commLink);
    await call('POST', `${acts}/${started.id}/join`, guest);

    const stroke = { id: 's1', points: [0.1, 0.1, 0.5, 0.5, 0.9, 0.2], color: '#3DCBFF', width: 4 };
    expect((await call('POST', `${acts}/${started.id}/events`, guest, { type: 'stroke', data: stroke })).json().ok).toBe(true);
    expect((await call('POST', `${acts}/${started.id}/events`, guest, { type: 'stroke', data: { points: [2, 2, 3, 3] } })).statusCode).toBe(400);
    expect((await call('GET', `${acts}/${started.id}/strokes`, host)).json().strokes).toMatchObject([{ id: 's1', color: '#3DCBFF', by: guest.id }]);
    expect((await call('POST', `${acts}/${started.id}/events`, guest, { type: 'watch', data: { playing: true } })).statusCode).toBe(400);

    // A second whiteboard beside the first: the guest moves to it and leaves the first.
    const second = (await call('POST', acts, guest, { kind: 'whiteboard' })).json().activity;
    expect(second.id).not.toBe(started.id);
    let list = (await call('GET', acts, host)).json().activities;
    expect(list.map((x: any) => [x.id, x.count])).toEqual([
      [started.id, 1],
      [second.id, 1],
    ]);
    // Each board keeps its own strokes.
    expect((await call('GET', `${acts}/${second.id}/strokes`, guest)).json().strokes).toEqual([]);

    // Leaving the comm-link leaves the activity; the last one out ends it.
    await inVoice(host, null);
    list = (await call('GET', acts, guest)).json().activities;
    expect(list.map((x: any) => x.id)).toEqual([second.id]);
    await call('POST', `${acts}/${second.id}/leave`, guest);
    expect((await call('GET', acts, guest)).json().activities).toEqual([]);
    expect((await call('POST', `${acts}/${second.id}/join`, guest)).json().code).toBe('NO_ACTIVITY');
    await inVoice(guest, null);
  });

  it('keeps Watch Together in sync, and profiles show it only to members it is shared with', async () => {
    if (!db || !redis) return;
    await inVoice(host, commLink);
    const acts = `/relays/${commLink}/activities`;
    expect((await call('POST', acts, host, { kind: 'watch', url: 'https://evil.example/page' })).json().code).toBe('INVALID_VIDEO_URL');
    expect((await call('POST', acts, host, { kind: 'watch', url: 'http://plain.example/clip.mp4' })).json().code).toBe('INVALID_VIDEO_URL');
    const a = (await call('POST', acts, host, { kind: 'watch', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).json().activity;
    expect(a.watch).toMatchObject({ playing: false, position: 0 });
    await call('POST', `${acts}/${a.id}/events`, host, { type: 'watch', data: { playing: true, position: 42 } });
    expect((await call('GET', acts, host)).json().activities[0].watch).toMatchObject({ playing: true, position: 42 });

    // Share my activity / Activity joining.
    expect((await call('GET', `/users/${host.id}/activity?beaconId=${beaconId}`, guest)).json().activity).toMatchObject({ kind: 'watch', relayId: commLink, joinable: true });
    await call('PATCH', `/beacons/${beaconId}/members/@me`, host, { activityJoining: false });
    expect((await call('GET', `/users/${host.id}/activity?beaconId=${beaconId}`, guest)).json().activity.joinable).toBe(false);
    await call('PATCH', `/beacons/${beaconId}/members/@me`, host, { shareActivity: false });
    expect((await call('GET', `/users/${host.id}/activity?beaconId=${beaconId}`, guest)).json().activity).toBeNull();
    expect((await call('GET', acts, guest)).json().activities).toMatchObject([{ count: 1, participants: [] }]);

    await call('POST', `${acts}/${a.id}/leave`, host);
    await inVoice(host, null);
  });
});
