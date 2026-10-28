import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { deliverDueReminders } from '../../apps/api-service/src/modules/users/inbox.routes.js';
import { PERMISSIONS } from '@subspace/constants';
import { reminders, bookmarks, transmitterNotes, pointToPointLinks, transmitters, eq, inArray, or } from '@subspace/database';
import { person, caller, seedPeople, cleanupPeople, captureBus } from '../support/security.js';

/**
 * Security: the Inbox (bookmarks, reminders, mentions, Mark Unread), private notes, custom
 * status and What's New. Everything here must only ever be about transmissions the caller can
 * read right now, and only ever reach the caller.
 */
describe('Security: inbox, notes, custom status and changelog', () => {
  let app: FastifyInstance;
  let db: any;
  const owner = person('803756946623540001', 'sib_owner');
  const reader = person('803756946623540002', 'sib_reader');
  const outsider = person('803756946623540003', 'sib_outsider');
  const dmA = person('803756946623540004', 'sib_dm_a');
  const dmB = person('803756946623540005', 'sib_dm_b');
  const people = [owner, reader, outsider, dmA, dmB];
  const { call } = caller(() => app);
  const VIEW = PERMISSIONS.VIEW_RELAY.toString();
  const soon = () => new Date(Date.now() + 3_600_000).toISOString();

  let beaconId = '';
  let general = '';
  let hidden = '';
  let everyoneRole = '';
  let publicPost = '';
  let hiddenPost = '';
  let otherBeaconPost = '';
  let dmPost = '';
  let dmLink = '';
  let botUserId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await seedPeople(db, people);
    beaconId = (await call(owner, 'POST', '/beacons', { name: 'Inbox Fort', isDiscoverable: true })).json().beacon.id;
    general = (await call(owner, 'GET', `/beacons/${beaconId}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
    hidden = (await call(owner, 'POST', `/beacons/${beaconId}/relays`, { name: 'mods-only', type: 'text' })).json().relay.id;
    everyoneRole = (await call(owner, 'GET', `/beacons/${beaconId}/clearances`)).json().clearances.find((c: any) => c.position === 0).id;
    await call(owner, 'PUT', `/beacons/${beaconId}/relays/${hidden}/overwrites/${everyoneRole}`, { targetType: 'clearance', allow: '0', deny: VIEW });
    for (const p of [reader, dmA, dmB]) await call(p, 'POST', `/beacons/${beaconId}/join`);
    publicPost = (await call(owner, 'POST', `/channels/relay/${general}/transmissions`, { content: 'public' })).json().transmission.id;
    hiddenPost = (await call(owner, 'POST', `/channels/relay/${hidden}/transmissions`, { content: `secret <@${reader.id}> @everyone` })).json().transmission.id;
    const other = (await call(outsider, 'POST', '/beacons', { name: 'Other Fort' })).json().beacon.id;
    const otherGeneral = (await call(outsider, 'GET', `/beacons/${other}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
    otherBeaconPost = (await call(outsider, 'POST', `/channels/relay/${otherGeneral}/transmissions`, { content: `elsewhere <@${reader.id}>` })).json().transmission.id;
    dmLink = (await call(dmA, 'POST', '/links', { targetId: dmB.id })).json().link.id;
    dmPost = (await call(dmA, 'POST', `/channels/link/${dmLink}/transmissions`, { content: `private <@${reader.id}>` })).json().transmission.id;
    const appId = (await call(owner, 'POST', '/applications', { name: 'Note Bot' })).json().application.id;
    botUserId = (await call(owner, 'POST', `/applications/${appId}/bot`)).json().bot.userId;
  });

  afterAll(async () => {
    if (db) {
      const ids = people.map((p) => p.id);
      await db.delete(pointToPointLinks).where(or(inArray(pointToPointLinks.transmitter1Id, ids), inArray(pointToPointLinks.transmitter2Id, ids)));
      await db.delete(transmitterNotes).where(or(inArray(transmitterNotes.ownerId, ids), inArray(transmitterNotes.targetId, ids)));
    }
    await cleanupPeople(db, people);
    await app.close();
  });

  it('bookmarks and reminders only on transmissions you can read: other beacons, DMs you are not in, hidden relays, unknown ids', async () => {
    if (!db) return;
    for (const id of [hiddenPost, otherBeaconPost, dmPost, '803756946623549999']) {
      expect((await call(reader, 'PUT', `/users/@me/bookmarks/${id}`)).statusCode, id).toBe(404);
      expect((await call(reader, 'POST', '/users/@me/reminders', { transmissionId: id, remindAt: soon() })).statusCode, id).toBe(404);
    }
    // Malformed ids.
    for (const id of ['abc', '0', '-1', '99999999999999999999']) expect((await call(reader, 'PUT', `/users/@me/bookmarks/${id}`)).statusCode, id).toBe(400);
    expect((await call(reader, 'POST', '/users/@me/reminders', { transmissionId: { $ne: null }, remindAt: soon() })).statusCode).toBe(400);
    expect(await db.select().from(bookmarks).where(eq(bookmarks.transmitterId, reader.id))).toEqual([]);
    expect(await db.select().from(reminders).where(eq(reminders.transmitterId, reader.id))).toEqual([]);
  });

  it('listing hides bookmarks and reminders after you lose access (and never leaks their content)', async () => {
    if (!db) return;
    const secretRelay = (await call(owner, 'POST', `/beacons/${beaconId}/relays`, { name: 'soon-hidden', type: 'text' })).json().relay.id;
    const t = (await call(owner, 'POST', `/channels/relay/${secretRelay}/transmissions`, { content: 'will be hidden later' })).json().transmission.id;
    expect((await call(reader, 'PUT', `/users/@me/bookmarks/${t}`)).statusCode).toBe(204);
    const r = (await call(reader, 'POST', '/users/@me/reminders', { transmissionId: t, remindAt: new Date(Date.now() + 1000).toISOString() })).json().reminder;
    expect((await call(reader, 'GET', '/users/@me/bookmarks')).body).toContain('will be hidden later');
    // The relay is hidden from @everyone now.
    await call(owner, 'PUT', `/beacons/${beaconId}/relays/${secretRelay}/overwrites/${everyoneRole}`, { targetType: 'clearance', allow: '0', deny: VIEW });
    expect((await call(reader, 'GET', '/users/@me/bookmarks')).body).not.toContain('will be hidden later');
    expect((await call(reader, 'GET', '/users/@me/reminders')).body).not.toContain('will be hidden later');
    // The due reminder is delivered to its owner only, and without the content they can no longer read.
    await db.update(reminders).set({ remindAt: new Date(Date.now() - 1000) }).where(eq(reminders.id, r.id));
    const events = await captureBus(() => deliverDueReminders(app));
    const due = events.filter((e) => e.type === 'REMINDER_DUE');
    for (const e of due) {
      expect(e.audience).toEqual([reader.id]);
      expect(JSON.stringify(e)).not.toContain('will be hidden later');
    }
    // Leaving the beacon hides everything from it, too.
    expect((await call(reader, 'PUT', `/users/@me/bookmarks/${publicPost}`)).statusCode).toBe(204);
    await call(reader, 'DELETE', `/beacons/${beaconId}/members/@me`).catch(() => null);
    await call(reader, 'POST', `/beacons/${beaconId}/leave`).catch(() => null);
    const after = (await call(reader, 'GET', '/users/@me/bookmarks')).json().bookmarks;
    expect(after.map((b: any) => b.transmission.id)).not.toContain(t);
    await call(reader, 'POST', `/beacons/${beaconId}/join`);
    await db.delete(bookmarks).where(eq(bookmarks.transmitterId, reader.id));
    await db.delete(reminders).where(eq(reminders.transmitterId, reader.id));
  });

  it('reminders: other people’s ids, time bounds, and the 100 limit', async () => {
    if (!db) return;
    const mine = (await call(owner, 'POST', '/users/@me/reminders', { transmissionId: publicPost, remindAt: soon() })).json().reminder;
    for (const [method, body] of [
      ['PATCH', { done: true }],
      ['PATCH', { remindAt: soon() }],
      ['DELETE', undefined],
    ] as const) {
      expect((await call(reader, method, `/users/@me/reminders/${mine.id}`, body)).statusCode, method).toBe(404);
    }
    const [row] = await db.select().from(reminders).where(eq(reminders.id, mine.id));
    expect(row.doneAt).toBeNull();
    for (const remindAt of ['', 'tomorrow', '1970-01-01T00:00:00Z', new Date(Date.now() - 5 * 60_000).toISOString(), new Date(Date.now() + 367 * 86_400_000).toISOString(), '275760-09-13T00:00:00Z', 'NaN', '2026-13-45T99:99:99Z']) {
      expect((await call(owner, 'POST', '/users/@me/reminders', { transmissionId: publicPost, remindAt })).statusCode, remindAt).toBe(400);
      expect((await call(owner, 'PATCH', `/users/@me/reminders/${mine.id}`, { remindAt })).statusCode, remindAt).toBe(400);
    }
    // Ownership can't be smuggled in.
    const smuggled = await call(reader, 'POST', '/users/@me/reminders', { transmissionId: publicPost, remindAt: soon(), transmitterId: owner.id });
    if (smuggled.statusCode === 201) {
      const [r] = await db.select().from(reminders).where(eq(reminders.id, smuggled.json().reminder.id));
      expect(r.transmitterId).toBe(reader.id);
      await db.delete(reminders).where(eq(reminders.id, r.id));
    }
    // Fill to the limit straight in the database, then the API refuses more.
    await db.insert(reminders).values(Array.from({ length: 99 }, () => ({ transmitterId: owner.id, transmissionId: publicPost, remindAt: new Date(Date.now() + 3_600_000) })));
    expect((await call(owner, 'POST', '/users/@me/reminders', { transmissionId: publicPost, remindAt: soon() })).json().code).toBe('MAX_REMINDERS');
    await db.delete(reminders).where(eq(reminders.transmitterId, owner.id));
  });

  it('REMINDER_DUE goes only to the reminder’s owner', async () => {
    if (!db) return;
    await db.insert(reminders).values({ transmitterId: reader.id, transmissionId: publicPost, remindAt: new Date(Date.now() - 1000) });
    const events = await captureBus(() => deliverDueReminders(app));
    const due = events.filter((e) => e.type === 'REMINDER_DUE');
    expect(due.length).toBeGreaterThanOrEqual(1);
    for (const e of due) expect(e.audience).toEqual([expect.any(String)]);
    expect(due.filter((e) => e.reminder?.transmission?.id === publicPost).every((e) => e.audience[0] === reader.id)).toBe(true);
    await db.delete(reminders).where(eq(reminders.transmitterId, reader.id));
  });

  it('mentions tab: nothing from hidden relays, other beacons or DMs you are not in', async () => {
    if (!db) return;
    const mentions = (await call(reader, 'GET', '/users/@me/mentions?limit=50')).json().mentions.map((m: any) => m.transmission.id);
    expect(mentions).not.toContain(hiddenPost);
    expect(mentions).not.toContain(otherBeaconPost);
    expect(mentions).not.toContain(dmPost);
    for (const q of ['before=not-a-date', 'limit=-5', 'limit=100000', 'everyone=maybe', 'before=275760-09-13T00:00:00.000Z']) {
      expect((await call(reader, 'GET', `/users/@me/mentions?${q}`)).statusCode, q).toBeLessThan(500);
    }
  });

  it('Mark Unread: only channels you can see, only transmissions of that channel', async () => {
    if (!db) return;
    const unread = (who: typeof owner, type: string, channel: string, transmissionId: string) => call(who, 'POST', `/channels/${type}/${channel}/unread`, { transmissionId });
    expect((await unread(reader, 'relay', hidden, hiddenPost)).statusCode).toBeGreaterThanOrEqual(403);
    expect((await unread(reader, 'link', dmLink, dmPost)).statusCode).toBeGreaterThanOrEqual(403);
    expect((await unread(outsider, 'relay', general, publicPost)).statusCode).toBeGreaterThanOrEqual(403);
    // A visible channel with a transmission id from a hidden one: refused, and nothing about it leaks.
    const cross = await unread(reader, 'relay', general, hiddenPost);
    expect(cross.statusCode).toBe(404);
    expect(cross.body).not.toContain('secret');
    // A thread id under a relay type, nonsense types, malformed ids.
    expect((await unread(reader, 'banana', general, publicPost)).statusCode).toBe(400);
    expect((await unread(reader, 'relay', 'abc', publicPost)).statusCode).toBe(400);
    expect((await unread(reader, 'relay', general, 'abc')).statusCode).toBe(400);
    // The mention count is computed only over the channel itself (the hidden @everyone is not counted).
    const ok = await unread(reader, 'relay', general, publicPost);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mentionCount).toBe(0);
  });

  it('private threads: their events, bookmarks, reminders and Mark Unread stay with their members', async () => {
    if (!db) return;
    let threadId = '';
    const created = await captureBus(async () => {
      const res = await call(owner, 'POST', `/relays/${general}/threads`, { name: 'Mods Backroom', private: true });
      expect(res.statusCode).toBe(201);
      threadId = res.json().thread.id;
    });
    const t = (await call(owner, 'POST', `/channels/thread/${threadId}/transmissions`, { content: `backroom <@${reader.id}>` })).json().transmission;
    expect(t?.id).toBeTruthy();
    const renamed = await captureBus(() => call(owner, 'PATCH', `/relays/${general}/threads/${threadId}`, { name: 'Renamed Backroom', isLocked: true }));
    for (const e of [...created, ...renamed].filter((x) => /^THREAD_|^TRANSMISSION_/.test(x.type))) expect(e.audience, e.type).not.toContain(reader.id);
    expect(renamed.some((e) => e.type === 'THREAD_UPDATE')).toBe(true);
    expect((await call(reader, 'PUT', `/users/@me/bookmarks/${t.id}`)).statusCode).toBe(404);
    expect((await call(reader, 'POST', '/users/@me/reminders', { transmissionId: t.id, remindAt: soon() })).statusCode).toBe(404);
    expect((await call(reader, 'POST', `/channels/thread/${threadId}/unread`, { transmissionId: t.id })).statusCode).toBeGreaterThanOrEqual(403);
    expect((await call(reader, 'GET', '/users/@me/mentions')).json().mentions.map((m: any) => m.transmission.id)).not.toContain(t.id);
    expect((await call(reader, 'GET', `/relays/${general}/threads`)).body).not.toContain('Backroom');
  });

  it('notes: only about people, only up to the limit, never visible to anyone else', async () => {
    if (!db) return;
    const put = (who: typeof owner, target: string, note: unknown) => call(who, 'PUT', `/users/${target}/note`, { note });
    expect((await put(reader, botUserId, 'a bot')).json().code).toBe('NOTE_NOT_ALLOWED');
    expect((await put(reader, '803756946623549998', 'nobody')).statusCode).toBe(404);
    for (const id of ['abc', '0', '-1', '99999999999999999999', '@me']) {
      const res = await put(reader, id, 'x');
      expect(res.statusCode, id).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, id).toBeLessThan(500);
    }
    expect((await put(reader, owner.id, 'x'.repeat(1025))).statusCode, 'x1025').toBe(400);
    // 1024 characters of emoji (2048 UTF-16 units) fits: the limit is in characters.
    expect((await put(reader, owner.id, '🛰'.repeat(1024))).statusCode, 'e1024').toBe(200);
    expect((await put(reader, owner.id, '🛰'.repeat(1025))).statusCode, 'e1025').toBe(400);
    await put(reader, owner.id, 'owner owes me 20 credits <img src=x onerror=alert(1)>');
    // The subject and everyone else see nothing of it.
    for (const who of [owner, outsider, dmA]) {
      expect((await call(who, 'GET', `/users/${owner.id}/note`)).json().note, who.username).toBeNull();
      const profile = await call(who, 'GET', `/users/${owner.id}/profile`);
      expect(profile.body, who.username).not.toContain('owes me');
      const members = await call(who, 'GET', `/beacons/${beaconId}/members`);
      expect(members.body, who.username).not.toContain('owes me');
    }
    expect((await call(reader, 'GET', `/users/${owner.id}/note`)).json().note).toContain('owes me');
  });

  it('GET /users/:id/note with a malformed id answers 4xx, not 500', async () => {
    if (!db) return;
    for (const id of ['abc', '99999999999999999999', "1' OR '1'='1"]) {
      const res = await call(reader, 'GET', `/users/${encodeURIComponent(id)}/note`);
      expect(res.statusCode, id).toBeLessThan(500);
    }
  });

  it('custom status: extra keys stripped, length in characters, emoji bounded, expiresAt validated', async () => {
    if (!db) return;
    const set = (customStatus: unknown) => call(reader, 'PATCH', '/users/@me/status', { customStatus });
    const via = (customStatus: unknown) => call(reader, 'PATCH', '/users/@me/profile', { customStatus });
    // Extra keys never reach other people.
    for (const send of [set, via]) {
      const res = await send({ text: 'hi', emoji: '🚀', admin: true, staffRank: 9, __html: '<b>x</b>' });
      expect(res.statusCode).toBeLessThan(500);
      const status = (await call(owner, 'GET', `/users/${reader.id}/profile`)).json().user.customStatus;
      if (status) expect(Object.keys(status).sort()).toEqual(expect.arrayContaining(['text']));
      if (status) for (const k of Object.keys(status)) expect(['text', 'emoji', 'expiresAt']).toContain(k);
    }
    // 128 characters, counted as characters (so 128 emoji are fine, 129 are not).
    expect((await set({ text: '🛰'.repeat(128) })).statusCode).toBe(200);
    expect((await set({ text: '🛰'.repeat(129) })).statusCode).toBe(400);
    expect((await via({ text: '🛰'.repeat(129) })).statusCode).toBe(400);
    expect((await set({ text: 'x', emoji: 'x'.repeat(65) })).statusCode).toBe(400);
    expect((await via({ text: 'x', emoji: 'x'.repeat(65) })).statusCode).toBe(400);
    for (const expiresAt of ['soon', '2026-99-99']) {
      expect((await set({ text: 'x', expiresAt })).statusCode, String(expiresAt)).toBe(400);
      expect((await via({ text: 'x', expiresAt })).statusCode, String(expiresAt)).toBe(400);
    }
    expect((await set({ text: 'x', expiresAt: 12345 })).statusCode).toBe(400);
    for (const bad of ['just a string', 42, [], { emoji: '🚀' }]) {
      expect((await set(bad)).statusCode, JSON.stringify(bad)).toBe(400);
      expect((await via(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    await set(null);
  });

  it('What’s New: only known platforms and well-formed dates, and only your own mark changes', async () => {
    if (!db) return;
    const put = (body: unknown) => call(reader, 'PUT', '/users/@me/changelog', body);
    expect((await put({ platform: 'web', seen: '2026-10-28' })).json().changelogSeen).toMatchObject({ web: '2026-10-28' });
    for (const body of [
      { platform: 'web', seen: '2026-10-28x1' },
      { platform: 'web', seen: '2026-10-28\n' },
      { platform: 'web', seen: "2026-10-28'); DROP TABLE transmitters;--" },
      { platform: 'web', seen: '' },
      { platform: '__proto__', seen: '2026-10-28' },
      { platform: 'ios', seen: '2026-10-28' },
      { platform: 'web' },
      { seen: '2026-10-28' },
      { platform: 'web', seen: 20261028 },
    ]) {
      expect((await put(body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    // Extra keys: no other user's mark, no other column.
    await put({ platform: 'desktop', seen: '2026-10-01', transmitterId: owner.id, staffRank: 3 });
    const [me] = await db.select().from(transmitters).where(eq(transmitters.id, reader.id));
    expect(me.staffRank).toBe(0);
    const [them] = await db.select().from(transmitters).where(eq(transmitters.id, owner.id));
    expect(them.changelogSeen ?? {}).not.toHaveProperty('desktop', '2026-10-01');
    // It's not visible to others.
    expect((await call(owner, 'GET', `/users/${reader.id}/profile`)).body).not.toContain('changelogSeen');
  });
});
