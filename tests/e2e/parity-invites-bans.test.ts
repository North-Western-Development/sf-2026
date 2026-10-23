import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { transmitters, invites, eq } from '@subspace/database';

describe('Parity Section 6: Invites, Bans, Members, Glyphs E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const ownerId = 'b0000000-0000-0000-0000-000000000001';
  const joinerId = 'b0000000-0000-0000-0000-000000000002';
  const bannedId = 'b0000000-0000-0000-0000-000000000003';
  const outsiderId = 'b0000000-0000-0000-0000-000000000004';

  let ownerToken: string, joinerToken: string, bannedToken: string, outsiderToken: string;
  let beaconId: string;
  let nonDiscoverableBeaconId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    const db = (app as any).db;
    if (db) {
      const users = [
        { id: ownerId, username: 'invite_owner', email: 'invite_owner@subspace.net', passwordHash: 'hash', displayName: 'Invite Owner' },
        { id: joinerId, username: 'invite_joiner', email: 'invite_joiner@subspace.net', passwordHash: 'hash', displayName: 'Invite Joiner' },
        { id: bannedId, username: 'invite_banned', email: 'invite_banned@subspace.net', passwordHash: 'hash', displayName: 'Invite Banned' },
        { id: outsiderId, username: 'invite_outsider', email: 'invite_outsider@subspace.net', passwordHash: 'hash', displayName: 'Invite Outsider' },
      ];
      for (const u of users) {
        const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
        if (existing.length === 0) await db.insert(transmitters).values(u);
      }
    }

    ownerToken = signAccessToken({ transmitterId: ownerId, username: 'invite_owner', staffRank: 0 }, JWT_SECRET);
    joinerToken = signAccessToken({ transmitterId: joinerId, username: 'invite_joiner', staffRank: 0 }, JWT_SECRET);
    bannedToken = signAccessToken({ transmitterId: bannedId, username: 'invite_banned', staffRank: 0 }, JWT_SECRET);
    outsiderToken = signAccessToken({ transmitterId: outsiderId, username: 'invite_outsider', staffRank: 0 }, JWT_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('provisions a discoverable and a non-discoverable beacon', async () => {
    if (!(app as any).db) return;
    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Invite Test Beacon', isDiscoverable: true },
    });
    expect(bRes.statusCode).toBe(201);
    beaconId = bRes.json().beacon.id;

    const nRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Private Invite Beacon', isDiscoverable: false },
    });
    nonDiscoverableBeaconId = nRes.json().beacon.id;
  });

  it('restricts POST /beacons/:id/join to discoverable beacons', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${nonDiscoverableBeaconId}/join`,
      headers: { authorization: `Bearer ${joinerToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('BEACON_NOT_DISCOVERABLE');
  });

  it('401s and 403s for creating invites', async () => {
    if (!(app as any).db) return;
    const noAuth = await app.inject({ method: 'POST', url: `/api/v1/beacons/${beaconId}/invites`, payload: {} });
    expect(noAuth.statusCode).toBe(401);

    const outsider = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/invites`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: {},
    });
    expect(outsider.statusCode).toBe(403);
  });

  it('validates invite creation body (400 on bad maxAgeSeconds/maxUses)', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { maxAgeSeconds: 123 },
    });
    expect(res.statusCode).toBe(400);

    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { maxUses: 1000 },
    });
    expect(res2.statusCode).toBe(400);
  });

  it('creates an invite, previews it publicly, and accepts it', async () => {
    if (!(app as any).db) return;
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { maxUses: 5, maxAgeSeconds: 3600 },
    });
    expect(createRes.statusCode).toBe(201);
    const code = createRes.json().invite.code;
    expect(code).toHaveLength(8);

    const previewRes = await app.inject({ method: 'GET', url: `/api/v1/invites/${code}` });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.json().beacon.name).toBe('Invite Test Beacon');
    expect(previewRes.json().inviter.username).toBe('invite_owner');

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invites/${code}/accept`,
      headers: { authorization: `Bearer ${joinerToken}` },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().requiresOnboarding).toBe(true);
    expect(acceptRes.json().beacon.id).toBe(beaconId);
  });

  it('rejects an invite past its max uses', async () => {
    if (!(app as any).db) return;
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { maxUses: 1, maxAgeSeconds: 3600 },
    });
    const code = createRes.json().invite.code;

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/invites/${code}/accept`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/invites/${code}/accept`,
      headers: { authorization: `Bearer ${bannedToken}` },
    });
    expect(second.statusCode).toBe(404);
  });

  it('rejects an expired invite', async () => {
    if (!(app as any).db) return;
    const db = (app as any).db;
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { maxAgeSeconds: 1800 },
    });
    const code = createRes.json().invite.code;
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.code, code));

    const res = await app.inject({ method: 'GET', url: `/api/v1/invites/${code}` });
    expect(res.statusCode).toBe(404);
  });

  it('lists only redeemable invites, each with its inviter', async () => {
    if (!(app as any).db) return;
    const db = (app as any).db;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const listed = res.json().invites as any[];
    expect(listed.length).toBeGreaterThan(0);
    const all = await db.select().from(invites).where(eq(invites.beaconId, beaconId));
    const dead = all.filter((i: any) => (i.expiresAt && new Date(i.expiresAt).getTime() <= Date.now()) || (i.maxUses && i.uses >= i.maxUses));
    expect(dead.length).toBeGreaterThanOrEqual(2); // the used-up and expired invites from the tests above
    for (const d of dead) expect(listed.some((i) => i.code === d.code)).toBe(false);
    for (const i of listed) {
      expect(i.inviter).toMatchObject({ id: ownerId, username: 'invite_owner' });
      expect(i.inviter.passwordHash).toBeUndefined();
      expect(i.inviter.email).toBeUndefined();
    }
  });

  it('bans a member: removes membership, blocks rejoin, and rejects invite accept', async () => {
    if (!(app as any).db) return;
    // Ban the joiner
    const banRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/beacons/${beaconId}/bans/${joinerId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: 'testing ban flow' },
    });
    expect(banRes.statusCode).toBe(200);

    // Membership removed -> member list no longer contains them
    const membersRes = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(membersRes.json().members.some((m: any) => m.transmitterId === joinerId)).toBe(false);

    // Direct join blocked
    const rejoinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/join`,
      headers: { authorization: `Bearer ${joinerToken}` },
    });
    expect(rejoinRes.statusCode).toBe(403);
    expect(rejoinRes.json().code).toBe('BANNED');

    // Invite accept also blocked
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });
    const code = createRes.json().invite.code;
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invites/${code}/accept`,
      headers: { authorization: `Bearer ${joinerToken}` },
    });
    expect(acceptRes.statusCode).toBe(403);
    expect(acceptRes.json().code).toBe('BANNED');
  });

  it('lifts a ban, allowing rejoin again', async () => {
    if (!(app as any).db) return;
    const unbanRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/beacons/${beaconId}/bans/${joinerId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(unbanRes.statusCode).toBe(200);

    const rejoinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/join`,
      headers: { authorization: `Bearer ${joinerToken}` },
    });
    expect(rejoinRes.statusCode).toBe(201);
  });

  it('enforces nickname change hierarchy on PATCH /beacons/:id/members/:userId', async () => {
    if (!(app as any).db) return;
    // Outsider (non-member) cannot patch anyone
    const notMember = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${beaconId}/members/${joinerId}`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: { nickname: 'Nope' },
    });
    expect(notMember.statusCode).toBe(403);

    // Joiner (no MANAGE_NICKNAMES) cannot rename the owner
    const noPerm = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${beaconId}/members/${ownerId}`,
      headers: { authorization: `Bearer ${joinerToken}` },
      payload: { nickname: 'Hijacked' },
    });
    expect(noPerm.statusCode).toBe(403);

    // Self-service nickname change is allowed (CHANGE_NICKNAME is a default @everyone bit)
    const selfRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${beaconId}/members/@me`,
      headers: { authorization: `Bearer ${joinerToken}` },
      payload: { nickname: 'Self Nick', bio: 'hello there', pronouns: 'they/them' },
    });
    expect(selfRes.statusCode).toBe(200);
    expect(selfRes.json().member.nickname).toBe('Self Nick');
    expect(selfRes.json().member.bio).toBe('hello there');
  });

  it('exposes per-beacon profile overrides in the member list', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const joiner = (res.json().members as any[]).find((m) => m.transmitterId === joinerId);
    expect(joiner.member).toMatchObject({ bio: 'hello there' });
  });

  it('validation: 400 on oversized per-beacon profile fields', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${beaconId}/members/@me`,
      headers: { authorization: `Bearer ${joinerToken}` },
      payload: { bio: 'x'.repeat(300) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a glyph upload without MANAGE_GLYPHS and rejects a non-media url', async () => {
    if (!(app as any).db) return;
    const noPerm = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/emojis`,
      headers: { authorization: `Bearer ${joinerToken}` },
      payload: { name: 'party_parrot', url: '/subspace-media/glyph/whatever.png' },
    });
    expect(noPerm.statusCode).toBe(403);

    const badUrl = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/emojis`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'evil', url: 'https://evil.example.com/x.png' },
    });
    expect(badUrl.statusCode).toBe(400);
    expect(badUrl.json().code).toBe('INVALID_MEDIA_URL');
  });
});
