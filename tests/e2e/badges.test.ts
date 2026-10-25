import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, transmissions, transmitterCommendations, pointToPointLinks, statsKey, eq, or } from '@subspace/database';

/** Badges: awarded from activity when a profile is viewed, one level per family on profiles. */
describe('Badges (commendations)', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const DAY = 86_400_000;
  // A two-year-old account with activity, a staff member, and a brand-new account.
  const veteran = { id: 'f9000000-0000-4000-8000-000000000001', username: 'badge_veteran', staffRank: 0, createdAt: new Date(Date.now() - 740 * DAY) };
  const staff = { id: 'f9000000-0000-4000-8000-000000000002', username: 'badge_staff', staffRank: 2, createdAt: new Date() };
  const viewer = { id: 'f9000000-0000-4000-8000-000000000003', username: 'badge_viewer', staffRank: 0, createdAt: new Date() };
  const users = [veteran, staff, viewer];
  const as = (u: (typeof users)[number]) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: u.staffRank }, SECRET)}` });
  const codes = async (u: (typeof users)[number], by = viewer) =>
    ((await app.inject({ method: 'GET', url: `/api/v1/users/${u.id}/profile`, headers: as(by) })).json().commendations as Array<{ code: string }>).map((c) => c.code);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    const ids = users.map((u) => u.id);
    await db.delete(transmitterCommendations).where(or(...ids.map((id) => eq(transmitterCommendations.transmitterId, id))));
    await db.delete(transmissions).where(or(...ids.map((id) => eq(transmissions.transmitterId, id))));
    await db.delete(pointToPointLinks).where(eq(pointToPointLinks.transmitter1Id, veteran.id));
    await db.delete(transmitters).where(or(...ids.map((id) => eq(transmitters.id, id))));
    for (const u of users) {
      await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, staffRank: u.staffRank, createdAt: u.createdAt });
    }
    // 120 transmissions (and a system message, which does not count).
    const [link] = await db.insert(pointToPointLinks).values({ transmitter1Id: veteran.id, transmitter2Id: viewer.id }).returning();
    await db.insert(transmissions).values([
      ...Array.from({ length: 120 }, (_, i) => ({ p2pLinkId: link.id, transmitterId: veteran.id, content: `hello ${i}` })),
      { p2pLinkId: link.id, transmitterId: veteran.id, content: '', type: 'system_call' },
    ]);
    // 6.5 hours in voice, as the gateway records it.
    await (app as any).redis?.hset(statsKey(veteran.id), 'voiceMinutes', '390');
  });

  afterAll(async () => {
    await (app as any).redis?.del(statsKey(veteran.id));
    await app.close();
  });

  it('awards levels from activity and shows only the highest level of each badge', async () => {
    if (!db) return;
    const shown = await codes(veteran);
    // Two years: Two Orbits (One Orbit is held but not shown). 120 sent: Chatter. 6.5 hours: Carrier.
    expect(shown).toEqual(expect.arrayContaining(['EARLY_TRANSMITTER', 'ORBIT_2', 'SIGNAL_2', 'COMM_LINK_2']));
    for (const lower of ['ORBIT_1', 'SIGNAL_1', 'COMM_LINK_1']) expect(shown).not.toContain(lower);
    for (const higher of ['ORBIT_3', 'SIGNAL_3', 'COMM_LINK_3']) expect(shown).not.toContain(higher);

    // Every level reached is held (the badge browser shows them as unlocked).
    const deck = (await app.inject({ method: 'GET', url: `/api/v1/transmitters/${veteran.id}/commendations`, headers: as(veteran) })).json().deck.map((b: any) => b.code);
    expect(deck).toEqual(expect.arrayContaining(['ORBIT_1', 'ORBIT_2', 'SIGNAL_1', 'SIGNAL_2', 'COMM_LINK_1', 'COMM_LINK_2']));
  });

  it('gives staff the staff badge, and new accounts only what they have earned', async () => {
    if (!db) return;
    expect(await codes(staff)).toEqual(['STAFF', 'EARLY_TRANSMITTER']);
    expect(await codes(viewer, staff)).toEqual(['EARLY_TRANSMITTER']);
  });

  it('lists the badge families with levels, marks granted badges as not unlockable, and reports your progress', async () => {
    if (!db) return;
    const res = await app.inject({ method: 'GET', url: '/api/v1/transmitters/commendations', headers: as(veteran) });
    expect(res.statusCode).toBe(200);
    const { families, progress } = res.json();
    const byName = Object.fromEntries(families.map((f: any) => [f.family, f]));
    expect(byName.staff.unlockable).toBe(false);
    expect(byName.early_transmitter.unlockable).toBe(false);
    expect(byName.comm_link.tiers.map((t: any) => t.threshold / 60)).toEqual([1, 5, 20, 75, 150, 300, 500, 1000]);
    expect(byName.signal.tiers[0]).toMatchObject({ code: 'SIGNAL_1', name: 'Ping', threshold: 10, iconUrl: '/badges/signal_1.svg' });
    expect(progress).toMatchObject({ voice_minutes: 390, transmissions_sent: 120 });
    expect(progress.account_age).toBeGreaterThanOrEqual(740);

    expect((await app.inject({ method: 'GET', url: '/api/v1/transmitters/commendations' })).statusCode).toBe(401);
  });

  it('hidden badges leave the profile, but the staff badge cannot be hidden', async () => {
    if (!db) return;
    const deck = (await app.inject({ method: 'GET', url: `/api/v1/transmitters/${veteran.id}/commendations`, headers: as(veteran) })).json().deck;
    const signal = deck.filter((b: any) => b.code.startsWith('SIGNAL_'));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/transmitters/me/commendations',
      headers: as(veteran),
      payload: { updates: signal.map((b: any) => ({ commendationId: b.commendationId, isVisible: false })) },
    });
    expect(res.statusCode).toBe(200);
    expect((await codes(veteran)).some((c) => c.startsWith('SIGNAL_'))).toBe(false);

    const staffDeck = (await app.inject({ method: 'GET', url: `/api/v1/transmitters/${staff.id}/commendations`, headers: as(staff) })).json().deck;
    const badge = staffDeck.find((b: any) => b.code === 'STAFF');
    const hide = await app.inject({ method: 'PATCH', url: '/api/v1/transmitters/me/commendations', headers: as(staff), payload: { updates: [{ commendationId: badge.commendationId, isVisible: false }] } });
    expect(hide.statusCode).toBe(400);
  });
});
