import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { deliverDueReminders } from '../../apps/api-service/src/modules/users/inbox.routes.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, reminders, eq, inArray } from '@subspace/database';

/** The Inbox: bookmarks, reminders and Mark Unread; notes and custom statuses. */
describe('Inbox, notes and statuses', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const reader = { id: '801756946623495001', username: 'ib_reader' };
  const poster = { id: '801756946623495002', username: 'ib_poster' };
  const outsider = { id: '801756946623495003', username: 'ib_outsider' };
  const people = [reader, poster, outsider];
  const ids = people.map((p) => p.id);
  const call = (u: { id: string; username: string }, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: { authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` }, payload: payload as any });
  let beaconId = '';
  let general = '';
  const posts: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(inArray(beacons.ownerId, ids));
    await db.delete(transmitters).where(inArray(transmitters.id, ids));
    await db.insert(transmitters).values(people.map((p) => ({ id: p.id, username: p.username, email: `${p.username}@subspace.test`, passwordHash: 'x', displayName: p.username, isEmailVerified: true })));
    beaconId = (await call(poster, 'POST', '/beacons', { name: 'Inbox Lab', isDiscoverable: true })).json().beacon.id;
    general = (await call(poster, 'GET', `/beacons/${beaconId}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
    await call(reader, 'POST', `/beacons/${beaconId}/join`);
    for (const content of ['one', `two <@${reader.id}>`, 'three', `four <@${reader.id}>`]) {
      posts.push((await call(poster, 'POST', `/channels/relay/${general}/transmissions`, { content })).json().transmission.id);
    }
  });

  afterAll(async () => {
    if (db) {
      await db.delete(beacons).where(inArray(beacons.ownerId, ids));
      await db.delete(transmitters).where(inArray(transmitters.id, ids));
    }
    await app.close();
  });

  it('bookmarks: only what you can read, and only yours', async () => {
    if (!db) return;
    expect((await call(reader, 'PUT', `/users/@me/bookmarks/${posts[2]}`)).statusCode).toBe(204);
    // Someone outside the beacon cannot bookmark (or learn about) its transmissions.
    expect((await call(outsider, 'PUT', `/users/@me/bookmarks/${posts[2]}`)).statusCode).toBe(404);
    const mine = (await call(reader, 'GET', '/users/@me/bookmarks')).json().bookmarks;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ transmission: { id: posts[2], content: 'three' }, channel: { channelType: 'relay', channelId: general, beaconName: 'Inbox Lab' } });
    expect((await call(outsider, 'GET', '/users/@me/bookmarks')).json().bookmarks).toEqual([]);

    // Leaving the beacon hides it again.
    await call(reader, 'POST', `/beacons/${beaconId}/leave`);
    expect((await call(reader, 'GET', '/users/@me/bookmarks')).json().bookmarks).toEqual([]);
    await call(reader, 'POST', `/beacons/${beaconId}/join`);
    expect((await call(reader, 'GET', '/users/@me/bookmarks')).json().bookmarks).toHaveLength(1);
    expect((await call(reader, 'DELETE', `/users/@me/bookmarks/${posts[2]}`)).statusCode).toBe(204);
    expect((await call(reader, 'GET', '/users/@me/bookmarks')).json().bookmarks).toEqual([]);
  });

  it('reminders: within a year, on what you can read, delivered once when due, done when you say', async () => {
    if (!db) return;
    expect((await call(reader, 'POST', '/users/@me/reminders', { transmissionId: posts[0], remindAt: 'tomorrow' })).json().code).toBe('INVALID_REMIND_AT');
    expect((await call(reader, 'POST', '/users/@me/reminders', { transmissionId: posts[0], remindAt: new Date(Date.now() + 400 * 86_400_000).toISOString() })).json().code).toBe('INVALID_REMIND_AT');
    expect((await call(outsider, 'POST', '/users/@me/reminders', { transmissionId: posts[0], remindAt: new Date(Date.now() + 3_600_000).toISOString() })).statusCode).toBe(404);

    const later = (await call(reader, 'POST', '/users/@me/reminders', { transmissionId: posts[0], remindAt: new Date(Date.now() + 3_600_000).toISOString() })).json().reminder;
    expect(later).toMatchObject({ due: false, transmission: { id: posts[0] } });
    const soon = (await call(reader, 'POST', '/users/@me/reminders', { transmissionId: posts[1], remindAt: new Date(Date.now() + 1000).toISOString() })).json().reminder;
    expect((await call(reader, 'GET', '/users/@me/reminders')).json().reminders.map((r: any) => r.id)).toEqual([soon.id, later.id]);

    await new Promise((r) => setTimeout(r, 1200));
    const before = await db.select().from(reminders).where(eq(reminders.id, soon.id));
    expect(before[0].notifiedAt).toBeNull();
    await deliverDueReminders(app);
    const after = await db.select().from(reminders).where(eq(reminders.id, soon.id));
    expect(after[0].notifiedAt).not.toBeNull();
    // Not twice.
    await deliverDueReminders(app);
    expect((await db.select().from(reminders).where(eq(reminders.id, soon.id)))[0].notifiedAt).toEqual(after[0].notifiedAt);

    // Someone else's reminder cannot be touched.
    expect((await call(outsider, 'PATCH', `/users/@me/reminders/${soon.id}`, { done: true })).statusCode).toBe(404);
    expect((await call(outsider, 'DELETE', `/users/@me/reminders/${soon.id}`)).statusCode).toBe(404);
    expect((await call(reader, 'PATCH', `/users/@me/reminders/${soon.id}`, { done: true })).statusCode).toBe(200);
    expect((await call(reader, 'GET', '/users/@me/reminders')).json().reminders.map((r: any) => r.id)).toEqual([later.id]);
    expect((await call(reader, 'DELETE', `/users/@me/reminders/${later.id}`)).statusCode).toBe(204);
  });

  it('Mark Unread: that transmission and everything after it, with its mentions counted again', async () => {
    if (!db) return;
    await call(reader, 'POST', `/channels/relay/${general}/ack`, { transmissionId: posts[3] });
    const marked = await call(reader, 'POST', `/channels/relay/${general}/unread`, { transmissionId: posts[1] });
    expect(marked.statusCode).toBe(200);
    // Read up to "one"; "two" and "four" mention them.
    expect(marked.json()).toEqual({ lastReadId: posts[0], mentionCount: 2 });
    const state = (await call(reader, 'GET', '/read-states')).json().readStates.find((r: any) => r.channelId === general);
    expect(state).toMatchObject({ lastReadId: posts[0], mentionCount: 2 });

    // From the first post: read up to whatever came before it (the beacon's own welcome).
    const fromFirst = (await call(reader, 'POST', `/channels/relay/${general}/unread`, { transmissionId: posts[0] })).json();
    expect(fromFirst.mentionCount).toBe(2);
    expect(fromFirst.lastReadId === null || BigInt(fromFirst.lastReadId) < BigInt(posts[0])).toBe(true);
    // Not someone else's channel, and only a transmission that is in this one.
    expect((await call(outsider, 'POST', `/channels/relay/${general}/unread`, { transmissionId: posts[1] })).statusCode).toBeGreaterThanOrEqual(403);
    const elsewhere = (await call(reader, 'POST', '/beacons', { name: 'Other Place' })).json().beacon.id;
    const otherRelay = (await call(reader, 'GET', `/beacons/${elsewhere}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
    expect((await call(reader, 'POST', `/channels/relay/${otherRelay}/unread`, { transmissionId: posts[1] })).statusCode).toBe(404);
  });

  it('notes are about people (yourself too), up to 1024 characters, and must name someone who exists', async () => {
    if (!db) return;
    expect((await call(reader, 'PUT', `/users/${poster.id}/note`, { note: 'Runs the lab' })).json().note).toBe('Runs the lab');
    expect((await call(reader, 'PUT', `/users/${reader.id}/note`, { note: 'Remember to water the plants' })).json().note).toBe('Remember to water the plants');
    expect((await call(reader, 'PUT', `/users/${poster.id}/note`, { note: 'n'.repeat(1024) })).statusCode).toBe(200);
    expect((await call(reader, 'PUT', `/users/${poster.id}/note`, { note: 'n'.repeat(1025) })).statusCode).toBe(400);
    const { application } = (await call(reader, 'POST', '/applications', { name: 'Note Bot' })).json();
    const { bot } = (await call(reader, 'POST', `/applications/${application.id}/bot`)).json();
    expect((await call(reader, 'PUT', `/users/${bot.userId}/note`, { note: 'a bot' })).json().code).toBe('NOTE_NOT_ALLOWED');
    await call(reader, 'DELETE', `/applications/${application.id}`);
    expect((await call(reader, 'PUT', '/users/801756946623495999/note', { note: 'ghost' })).statusCode).toBe(404);
    expect((await call(reader, 'PUT', '/users/not-an-id/note', { note: 'x' })).statusCode).toBe(404);
    // Only the writer sees it.
    expect((await call(outsider, 'GET', `/users/${poster.id}/note`)).json().note).toBeNull();
  });

  it('custom statuses: 128 characters at most, and nothing but text, emoji and expiry is kept', async () => {
    if (!db) return;
    expect((await call(reader, 'PATCH', '/users/@me/profile', { customStatus: { text: 'x'.repeat(129) } })).statusCode).toBe(400);
    // 128 emoji are 128 characters, though 256 UTF-16 units.
    expect((await call(reader, 'PATCH', '/users/@me/profile', { customStatus: { text: '🚀'.repeat(128) } })).statusCode).toBe(200);
    const saved = await call(reader, 'PATCH', '/users/@me/profile', { customStatus: { text: '  Charging  ', emoji: '⚡', evil: '<script>', html: true } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().transmitter.customStatus).toEqual({ text: 'Charging', emoji: '⚡' });
    expect((await call(reader, 'PATCH', '/users/@me/profile', { customStatus: { text: 'ok', expiresAt: 'soon' } })).statusCode).toBe(400);
  });
});
