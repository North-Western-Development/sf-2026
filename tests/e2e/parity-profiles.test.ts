import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, hashPassword } from '@subspace/crypto';
import { transmitters, affiliations, signalBlacklist, eq } from '@subspace/database';

describe('Parity Section 9: Profiles E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const everyoneId = '852781502797185025';
  const friendsOnlyId = '852781502797185026';
  const friendId = '852781502797185027';
  const strangerId = '852781502797185028';
  const blockedId = '852781502797185029';

  const STRANGER_PASSWORD = 'StrangerPassword1';
  let everyoneToken: string, friendsOnlyToken: string, friendToken: string, strangerToken: string, blockedToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    const db = (app as any).db;
    if (db) {
      const strangerHash = await hashPassword(STRANGER_PASSWORD);
      const users = [
        { id: everyoneId, username: 'profile_everyone', email: 'p_everyone@subspace.net', passwordHash: 'hash', displayName: 'Everyone Vis' },
        { id: friendsOnlyId, username: 'profile_friendsonly', email: 'p_friendsonly@subspace.net', passwordHash: 'hash', displayName: 'Friends Only Vis', profileVisibility: 'friends' },
        { id: friendId, username: 'profile_friend', email: 'p_friend@subspace.net', passwordHash: 'hash', displayName: 'A Friend' },
        { id: strangerId, username: 'profile_stranger', email: 'p_stranger@subspace.net', passwordHash: strangerHash, displayName: 'A Stranger' },
        { id: blockedId, username: 'profile_blocked', email: 'p_blocked@subspace.net', passwordHash: 'hash', displayName: 'Blocked User' },
      ];
      for (const u of users) {
        const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
        if (existing.length === 0) await db.insert(transmitters).values(u);
        else await db.update(transmitters).set(u).where(eq(transmitters.id, u.id));
      }
      await db
        .insert(affiliations)
        .values({ transmitterId: friendsOnlyId, targetId: friendId, status: 'accepted' })
        .onConflictDoNothing?.();
      await db
        .insert(signalBlacklist)
        .values({ transmitterId: everyoneId, targetId: blockedId, targetType: 'transmitter' })
        .onConflictDoNothing?.();
    }

    everyoneToken = signAccessToken({ transmitterId: everyoneId, username: 'profile_everyone', staffRank: 0 }, JWT_SECRET);
    friendsOnlyToken = signAccessToken({ transmitterId: friendsOnlyId, username: 'profile_friendsonly', staffRank: 0 }, JWT_SECRET);
    friendToken = signAccessToken({ transmitterId: friendId, username: 'profile_friend', staffRank: 0 }, JWT_SECRET);
    strangerToken = signAccessToken({ transmitterId: strangerId, username: 'profile_stranger', staffRank: 0 }, JWT_SECRET);
    blockedToken = signAccessToken({ transmitterId: blockedId, username: 'profile_blocked', staffRank: 0 }, JWT_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('401s without a token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${everyoneId}/profile` });
    expect(res.statusCode).toBe(401);
  });

  it('enforces username rules on profile update: rejects invalid, accepts valid', async () => {
    if (!(app as any).db) return;
    const invalidCases = ['a', 'has spaces', '.leadingdot', 'trailingdot.', 'double..dot', 'x'.repeat(33), 'Ünïcode'];
    for (const bad of invalidCases) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/@me/profile',
        headers: { authorization: `Bearer ${strangerToken}` },
        payload: { username: bad },
      });
      expect(res.statusCode, `expected ${bad} to be rejected`).toBe(400);
      expect(res.json().code).toBe('INVALID_USERNAME');
    }

    const validRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/@me/profile',
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { username: 'valid_username.2', password: STRANGER_PASSWORD },
    });
    expect(validRes.statusCode).toBe(200);
    expect(validRes.json().transmitter.username).toBe('valid_username.2');
  });

  it('validates bio length, hex colors, and displayNameStyle enums', async () => {
    if (!(app as any).db) return;
    const bioTooLong = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/@me/profile',
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { bio: 'x'.repeat(200) },
    });
    expect(bioTooLong.statusCode).toBe(400);

    const badColor = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/@me/profile',
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { themePrimary: 'not-a-color' },
    });
    expect(badColor.statusCode).toBe(400);

    const badStyle = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/@me/profile',
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { displayNameStyle: { font: 'comic-sans', effect: 'solid', colors: ['#ffffff'] } },
    });
    expect(badStyle.statusCode).toBe(400);

    const goodRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/@me/profile',
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: {
        bio: 'A concise bio',
        themePrimary: '#112233',
        displayNameStyle: { font: 'orbitron', effect: 'neon', colors: ['#ffffff', '#000000'] },
      },
    });
    expect(goodRes.statusCode).toBe(200);
  });

  it('honours profile_visibility=everyone (default): any authenticated user can view', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${everyoneId}/profile`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(everyoneId);
    expect(res.json().relationship).toBe('none');
  });

  it('honours profile_visibility=friends: strangers get 404, friends can view', async () => {
    if (!(app as any).db) return;
    const strangerRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${friendsOnlyId}/profile`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(strangerRes.statusCode).toBe(404);

    const friendRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${friendsOnlyId}/profile`,
      headers: { authorization: `Bearer ${friendToken}` },
    });
    expect(friendRes.statusCode).toBe(200);
    expect(friendRes.json().relationship).toBe('friend');
  });

  it('honours blocks in both directions regardless of visibility', async () => {
    if (!(app as any).db) return;
    const asBlocker = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${blockedId}/profile`,
      headers: { authorization: `Bearer ${everyoneToken}` },
    });
    expect(asBlocker.statusCode).toBe(404);

    const asBlocked = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${everyoneId}/profile`,
      headers: { authorization: `Bearer ${blockedToken}` },
    });
    expect(asBlocked.statusCode).toBe(404);
  });

  it('self profile is always visible to self regardless of profile_visibility', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${friendsOnlyId}/profile`,
      headers: { authorization: `Bearer ${friendsOnlyToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().relationship).toBe('self');
  });

  it('404s profile for an unknown transmitter id', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/100000000000000000/profile',
      headers: { authorization: `Bearer ${everyoneToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('private notes: writable, readable only by the owner, and empty string deletes', async () => {
    if (!(app as any).db) return;
    const writeRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${everyoneId}/note`,
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { note: 'Met at the subspace relay conference' },
    });
    expect(writeRes.statusCode).toBe(200);
    expect(writeRes.json().note).toBe('Met at the subspace relay conference');

    // Only the note owner sees it via GET note
    const ownerReadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${everyoneId}/note`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(ownerReadRes.json().note).toBe('Met at the subspace relay conference');

    // Another transmitter's note about the same target is independent (starts empty)
    const otherReadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${everyoneId}/note`,
      headers: { authorization: `Bearer ${friendToken}` },
    });
    expect(otherReadRes.json().note).toBeNull();

    // The profile GET only ever surfaces the caller's own note, never someone else's
    const profileRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${everyoneId}/profile`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(profileRes.json().note).toBe('Met at the subspace relay conference');

    const profileAsFriendRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${everyoneId}/profile`,
      headers: { authorization: `Bearer ${friendToken}` },
    });
    expect(profileAsFriendRes.json().note).toBeNull();

    // Empty string deletes
    const deleteRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${everyoneId}/note`,
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { note: '' },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().note).toBeNull();
  });
});
