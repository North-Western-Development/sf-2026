import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, beacons, beaconMembers, eq, or } from '@subspace/database';

/** Members page, Channels & Roles (onboarding questions, browse channels) and Events. */
describe('Beacon community: members page, channels & roles, events', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: 'fa000000-0000-4000-8000-000000000001', username: 'comm_owner' };
  const pilot = { id: 'fa000000-0000-4000-8000-000000000002', username: 'comm_pilot' };
  const quiet = { id: 'fa000000-0000-4000-8000-000000000003', username: 'comm_quiet' };
  const users = [owner, pilot, quiet];
  const auth = (u: { id: string; username: string }) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: { id: string; username: string }, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1/beacons${url}`, headers: auth(u), payload: payload as any });

  let beaconId = '';
  let textId = '';
  let commId = '';
  let lockedRelayId = '';
  let roleId = '';
  let modRoleId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) {
      await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: u !== quiet });
    }
    const b = await call('POST', '', owner, { name: 'Community Beacon', isDiscoverable: true });
    beaconId = b.json().beacon.id;
    const relays = (await call('GET', `/${beaconId}/relays`, owner)).json().relays;
    textId = relays.find((r: any) => r.type === 'text').id;
    commId = relays.find((r: any) => r.type === 'comm_link').id;
    lockedRelayId = (await call('POST', `/${beaconId}/relays`, owner, { name: 'rules', type: 'text', isUnhideable: true })).json().relay.id;
    roleId = (await call('POST', `/${beaconId}/clearances`, owner, { name: 'Zomboid', position: 2, permissions: '0', allowDelegation: true })).json().clearance.id;
    modRoleId = (await call('POST', `/${beaconId}/clearances`, owner, { name: 'Mod', position: 3, permissions: PERMISSIONS.KICK_MEMBERS.toString() })).json().clearance.id;
    await call('POST', `/${beaconId}/join`, pilot);
    await call('POST', `/${beaconId}/join`, quiet);
    // quiet joined 40 days ago and never spoke: a prune candidate.
    await db.update(beaconMembers).set({ joinedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(beaconMembers.transmitterId, quiet.id));
  });

  afterAll(async () => {
    if (db) await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await app.close();
  });

  describe('Members page', () => {
    it('shows join method, account age and signals to moderators only', async () => {
      if (!db) return;
      expect((await call('GET', `/${beaconId}/member-details`, pilot)).statusCode).toBe(403);
      const res = await call('GET', `/${beaconId}/member-details`, owner);
      expect(res.statusCode).toBe(200);
      const byId = Object.fromEntries(res.json().members.map((m: any) => [m.transmitterId, m]));
      expect(byId[owner.id].joinMethod).toBe('owner');
      expect(byId[pilot.id].joinMethod).toBe('discovery');
      expect(byId[quiet.id].signals).toEqual(expect.arrayContaining(['new_account', 'unverified_email']));
      expect(byId[pilot.id].signals).not.toContain('unverified_email');
    });

    it('counts and prunes quiet members without clearances, never the owner', async () => {
      if (!db) return;
      expect((await call('GET', `/${beaconId}/prune?days=7`, pilot)).statusCode).toBe(403);
      expect((await call('GET', `/${beaconId}/prune?days=3`, owner)).statusCode).toBe(400);
      expect((await call('GET', `/${beaconId}/prune?days=30`, owner)).json().count).toBe(1);
      expect((await call('POST', `/${beaconId}/prune`, owner, { days: 30 })).json().pruned).toBe(1);
      const left = await db.select().from(beaconMembers).where(eq(beaconMembers.beaconId, beaconId));
      expect(left.map((m: any) => m.transmitterId).sort()).toEqual([owner.id, pilot.id].sort());
    });
  });

  describe('Channels & Roles', () => {
    it('only managers edit questions, and options cannot hand out moderation clearances', async () => {
      if (!db) return;
      const q = (clearanceIds: string[]) => ({ questions: [{ title: 'What games do you play?', multiple: true, options: [{ label: 'Zomboid', emoji: '🧟', clearanceIds, relayIds: [textId] }] }] });
      expect((await call('PUT', `/${beaconId}/onboarding-questions`, pilot, q([roleId]))).statusCode).toBe(403);
      const unsafe = await call('PUT', `/${beaconId}/onboarding-questions`, owner, q([modRoleId]));
      expect(unsafe.statusCode).toBe(400);
      expect(unsafe.json().code).toBe('UNSAFE_CLEARANCE');
      expect((await call('PUT', `/${beaconId}/onboarding-questions`, owner, { questions: [{ title: '', options: [{ label: 'x' }] }] })).statusCode).toBe(400);
      const ok = await call('PUT', `/${beaconId}/onboarding-questions`, owner, {
        questions: [
          q([roleId]).questions[0],
          { title: 'Pick a timezone', multiple: false, options: [{ label: 'EU' }, { label: 'NA' }] },
        ],
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().questions).toHaveLength(2);
    });

    it('answers grant and remove clearances, single-choice questions take one answer, and answers show their relays', async () => {
      if (!db) return;
      const { questions } = (await call('GET', `/${beaconId}/onboarding-questions`, pilot)).json();
      const zomboid = questions[0].options[0].id;
      const [eu, na] = questions[1].options.map((o: any) => o.id);
      expect((await call('PUT', `/${beaconId}/onboarding-selections`, pilot, { optionIds: [eu, na] })).statusCode).toBe(400);
      expect((await call('PUT', `/${beaconId}/onboarding-selections`, pilot, { optionIds: ['nope'] })).statusCode).toBe(400);

      // Hidden first; picking the option brings the relay back.
      await call('PUT', `/${beaconId}/relay-prefs`, pilot, { hiddenRelayIds: [textId] });
      const picked = await call('PUT', `/${beaconId}/onboarding-selections`, pilot, { optionIds: [zomboid, eu] });
      expect(picked.statusCode).toBe(200);
      expect(picked.json().clearanceIds).toContain(roleId);
      expect(picked.json().hiddenRelayIds).not.toContain(textId);

      const dropped = await call('PUT', `/${beaconId}/onboarding-selections`, pilot, { optionIds: [eu] });
      expect(dropped.json().clearanceIds).not.toContain(roleId);
    });

    it('members hide relays for themselves only, never unhideable ones, and see recent activity', async () => {
      if (!db) return;
      await call('POST', `/${beaconId}/relays/${textId}/transmissions`, owner, { content: 'hello' });
      const put = await call('PUT', `/${beaconId}/relay-prefs`, pilot, { hiddenRelayIds: [textId, lockedRelayId, 'not-a-relay'] });
      expect(put.json().hiddenRelayIds).toEqual([textId]);
      const got = (await call('GET', `/${beaconId}/relay-prefs`, pilot)).json();
      expect(got.hiddenRelayIds).toEqual([textId]);
      expect((await call('GET', `/${beaconId}/relay-prefs`, owner)).json().hiddenRelayIds).toEqual([]);
      expect(typeof got.activity).toBe('object');
    });
  });

  describe('Events', () => {
    let eventId = '';
    const soon = () => new Date(Date.now() + 3_600_000).toISOString();

    it('creating needs CREATE_EVENTS and a valid location and time', async () => {
      if (!db) return;
      expect((await call('POST', `/${beaconId}/events`, pilot, { name: 'Raid night', locationType: 'comm_link', relayId: commId, startAt: soon() })).statusCode).toBe(403);
      const bad = [
        { name: '', locationType: 'comm_link', relayId: commId, startAt: soon() },
        { name: 'x', locationType: 'comm_link', relayId: textId, startAt: soon() },
        { name: 'x', locationType: 'external', location: 'The pub', startAt: soon() },
        { name: 'x', locationType: 'comm_link', relayId: commId, startAt: new Date(Date.now() - 86_400_000).toISOString() },
      ];
      for (const b of bad) expect((await call('POST', `/${beaconId}/events`, owner, b)).statusCode).toBe(400);
      const res = await call('POST', `/${beaconId}/events`, owner, { name: 'Raid night', description: 'Bring snacks', locationType: 'comm_link', relayId: commId, startAt: soon() });
      expect(res.statusCode).toBe(201);
      eventId = res.json().event.id;
      expect(res.json().event).toMatchObject({ status: 'scheduled', interestedCount: 1, meInterested: true });
    });

    it('members mark interest; only the host or event managers edit', async () => {
      if (!db) return;
      await call('POST', `/${beaconId}/join`, quiet);
      const on = await call('PUT', `/${beaconId}/events/${eventId}/interest`, pilot);
      expect(on.json().event).toMatchObject({ interestedCount: 2, meInterested: true });
      const list = (await call('GET', `/${beaconId}/events`, pilot)).json().events;
      expect(list).toHaveLength(1);
      expect((await call('GET', `/${beaconId}/events/${eventId}/interested`, quiet)).json().users).toHaveLength(2);
      expect((await call('PATCH', `/${beaconId}/events/${eventId}`, pilot, { name: 'Mine now' })).statusCode).toBe(403);
      expect((await call('DELETE', `/${beaconId}/events/${eventId}`, pilot)).statusCode).toBe(403);
      const off = await call('DELETE', `/${beaconId}/events/${eventId}/interest`, pilot);
      expect(off.json().event).toMatchObject({ interestedCount: 1, meInterested: false });
    });

    it('moves scheduled -> active -> completed, and completed events leave the list', async () => {
      if (!db) return;
      expect((await call('PATCH', `/${beaconId}/events/${eventId}`, owner, { status: 'completed' })).statusCode).toBe(400);
      const live = await call('PATCH', `/${beaconId}/events/${eventId}`, owner, { status: 'active' });
      expect(live.json().event.status).toBe('active');
      expect(new Date(live.json().event.startAt).getTime()).toBeLessThanOrEqual(Date.now());
      expect((await call('PATCH', `/${beaconId}/events/${eventId}`, owner, { status: 'completed' })).json().event.status).toBe('completed');
      expect((await call('GET', `/${beaconId}/events`, owner)).json().events).toHaveLength(0);
    });

    it('starts and ends on its own at the scheduled times, then schedules the next weekly occurrence', async () => {
      if (!db) return;
      const start = new Date(Date.now() + 3_600_000);
      const end = new Date(start.getTime() + 7_200_000);
      const created = await call('POST', `/${beaconId}/events`, owner, { name: 'Weekly ops', locationType: 'comm_link', relayId: commId, startAt: start.toISOString(), endAt: end.toISOString(), recurrence: 'weekly' });
      expect(created.json().event.recurrence).toBe('weekly');
      expect((await call('POST', `/${beaconId}/events`, owner, { name: 'x', locationType: 'comm_link', relayId: commId, startAt: start.toISOString(), recurrence: 'hourly' })).statusCode).toBe(400);
      const id = created.json().event.id;
      await call('PUT', `/${beaconId}/events/${id}/interest`, pilot);

      const { runEventTick } = await import('../../apps/api-service/src/modules/events/events.routes.js');
      await runEventTick!(new Date(start.getTime() + 1000));
      let list = (await call('GET', `/${beaconId}/events`, owner)).json().events;
      expect(list.find((e: any) => e.id === id).status).toBe('active');

      await runEventTick!(new Date(end.getTime() + 1000));
      list = (await call('GET', `/${beaconId}/events`, pilot)).json().events;
      expect(list.find((e: any) => e.id === id)).toBeUndefined();
      const next = list.find((e: any) => e.name === 'Weekly ops');
      expect(next.status).toBe('scheduled');
      expect(new Date(next.startAt).getTime() - start.getTime()).toBe(7 * 86_400_000);
      expect(new Date(next.endAt).getTime() - new Date(next.startAt).getTime()).toBe(7_200_000);
      // Interest carries over to the next occurrence.
      expect(next).toMatchObject({ meInterested: true, interestedCount: 2 });
      await call('DELETE', `/${beaconId}/events/${next.id}`, owner);
    });

    it('external events need an end, and the host can delete', async () => {
      if (!db) return;
      const start = new Date(Date.now() + 3_600_000);
      const res = await call('POST', `/${beaconId}/events`, owner, { name: 'Meetup', locationType: 'external', location: 'Central Park', startAt: start.toISOString(), endAt: new Date(start.getTime() + 7_200_000).toISOString() });
      expect(res.statusCode).toBe(201);
      expect((await call('DELETE', `/${beaconId}/events/${res.json().event.id}`, owner)).statusCode).toBe(204);
      expect((await call('GET', `/${beaconId}/events`, owner)).json().events).toHaveLength(0);
    });
  });
});
