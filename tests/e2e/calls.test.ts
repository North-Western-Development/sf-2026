import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, transmissions, pointToPointLinks, signalBlacklist, affiliations, eq, or } from '@subspace/database';

/** Direct-link call records: ringing, joining, declining, and who may do any of it. */
describe('Calls in direct links', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let redis: any;
  const caller = { id: 'c6000000-0000-4000-8000-000000000001', username: 'call_caller' };
  const callee = { id: 'c6000000-0000-4000-8000-000000000002', username: 'call_callee' };
  const stranger = { id: 'c6000000-0000-4000-8000-000000000003', username: 'call_stranger' };
  const tok = (u: typeof caller) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const inject = (method: string, url: string, u?: typeof caller) =>
    app.inject({ method: method as any, url, headers: u ? { authorization: `Bearer ${tok(u)}` } : {}, payload: method === 'POST' ? {} : undefined });
  let linkId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    redis = (app as any).redis;
    if (!db || !redis) return;
    const ids = [caller.id, callee.id, stranger.id];
    await db.delete(pointToPointLinks).where(or(...ids.map((id) => eq(pointToPointLinks.transmitter1Id, id))));
    await db.delete(signalBlacklist).where(or(...ids.map((id) => eq(signalBlacklist.transmitterId, id))));
    await db.delete(affiliations).where(or(...ids.map((id) => eq(affiliations.transmitterId, id))));
    for (const u of [caller, callee, stranger]) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (!existing.length) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username });
    }
    const [link] = await db.insert(pointToPointLinks).values({ transmitter1Id: caller.id, transmitter2Id: callee.id }).returning();
    linkId = link.id;
    await redis.del(`call:link:${linkId}`, `call:link:${linkId}:joined`);
  });

  afterAll(async () => {
    await redis?.del(`call:link:${linkId}`, `call:link:${linkId}:joined`);
    await app.close();
  });

  it('only the two people in the link can start, see or join its call', async () => {
    if (!db || !redis) return;
    expect((await inject('POST', `/api/v1/calls/link/${linkId}/ring`, stranger)).statusCode).toBe(404);
    expect((await inject('POST', `/api/v1/calls/link/${linkId}/token`, stranger)).statusCode).toBe(404);
    expect((await inject('POST', `/api/v1/calls/link/${linkId}/ring`)).statusCode).toBe(401);
    expect((await inject('POST', `/api/v1/calls/mesh/not-a-uuid/ring`, caller)).statusCode).toBe(400);
  });

  it('there is no call to join until someone starts one', async () => {
    if (!db || !redis) return;
    const res = await inject('POST', `/api/v1/calls/link/${linkId}/token`, callee);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('NO_ACTIVE_CALL');
  });

  it('starting a call posts "started a call", rings the other person, and expires unanswered', async () => {
    if (!db || !redis) return;
    const res = await inject('POST', `/api/v1/calls/link/${linkId}/ring`, caller);
    expect(res.statusCode).toBe(201);
    const { call } = res.json();
    expect(call).toMatchObject({ channelType: 'link', channelId: linkId, startedBy: caller.id, ringing: [callee.id] });
    const [message] = await db.select().from(transmissions).where(eq(transmissions.id, call.messageId));
    expect(message).toMatchObject({ type: 'system_call', transmitterId: caller.id, p2pLinkId: linkId });
    const ttl = await redis.ttl(`call:link:${linkId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(90);

    // Ringing again while it runs does not post a second message.
    const again = await inject('POST', `/api/v1/calls/link/${linkId}/ring`, caller);
    expect(again.statusCode).toBe(200);
    expect(again.json().call.messageId).toBe(call.messageId);

    const listed = await inject('GET', `/api/v1/calls?channels=link:${linkId}`, callee);
    expect(listed.json().calls).toHaveLength(1);
    expect((await inject('GET', `/api/v1/calls?channels=link:${linkId}`, stranger)).json().calls).toEqual([]);
  });

  it('joining stops the ringing, keeps the call alive and returns a LiveKit grant for its room', async () => {
    if (!db || !redis) return;
    await inject('POST', `/api/v1/calls/link/${linkId}/token`, caller);
    const res = await inject('POST', `/api/v1/calls/link/${linkId}/token`, callee);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roomName).toBe(`call-link-${linkId}`);
    expect(body.call.ringing).toEqual([]);
    const grant = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
    expect(grant.sub).toBe(callee.id);
    expect(grant.video).toMatchObject({ room: `call-link-${linkId}`, roomJoin: true, canPublish: true });
    expect(await redis.ttl(`call:link:${linkId}`)).toBe(-1);
    expect((await redis.smembers(`call:link:${linkId}:joined`)).sort()).toEqual([caller.id, callee.id].sort());
  });

  it('declining removes only the decliner from the ring list', async () => {
    if (!db || !redis) return;
    await inject('POST', `/api/v1/calls/link/${linkId}/ring`, callee); // re-ring: nobody left to ring
    await redis.set(`call:link:${linkId}`, JSON.stringify({ ...(JSON.parse(await redis.get(`call:link:${linkId}`))), ringing: [callee.id] }), 'KEEPTTL');
    expect((await inject('POST', `/api/v1/calls/link/${linkId}/decline`, callee)).statusCode).toBe(204);
    expect(JSON.parse(await redis.get(`call:link:${linkId}`)).ringing).toEqual([]);
    expect((await inject('POST', `/api/v1/calls/link/${linkId}/decline`, stranger)).statusCode).toBe(404);
  });

  it('blocking ends the right to call', async () => {
    if (!db || !redis) return;
    await db.insert(signalBlacklist).values({ transmitterId: callee.id, targetType: 'transmitter', targetId: caller.id });
    expect((await inject('POST', `/api/v1/calls/link/${linkId}/token`, caller)).statusCode).toBe(404);
    expect((await inject('POST', `/api/v1/calls/link/${linkId}/ring`, caller)).statusCode).toBe(404);
  });
});
