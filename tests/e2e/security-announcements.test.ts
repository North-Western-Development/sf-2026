import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { PERMISSIONS } from '@subspace/constants';
import { webhooks, transmissions, eq, and } from '@subspace/database';
import { person, caller, seedPeople, cleanupPeople } from '../support/security.js';

/**
 * Security: announcement relays, following them, and publishing. Who may follow what into where,
 * who may publish, what may be published, that copies never ping, and that follower webhooks
 * cannot be turned into ordinary, executable webhooks.
 */
describe('Security: announcement relays and follows', () => {
  let app: FastifyInstance;
  let db: any;
  const owner = person('803756946623530001', 'san_owner');
  const poster = person('803756946623530002', 'san_poster'); // member of the news beacon who can post
  const reader = person('803756946623530003', 'san_reader'); // member who can only read
  const follower = person('803756946623530004', 'san_follower'); // owns the beacon that follows
  const helper = person('803756946623530005', 'san_helper'); // member of follower's beacon without Manage Webhooks
  const outsider = person('803756946623530006', 'san_outsider');
  const people = [owner, poster, reader, follower, helper, outsider];
  const { call } = caller(() => app);
  const VIEW = PERMISSIONS.VIEW_RELAY.toString();

  let newsBeacon = '';
  let news = '';
  let secretNews = '';
  let general = '';
  let home = '';
  let feed = '';
  let outsiderBeacon = '';
  let outsiderRelay = '';
  let everyoneRole = '';
  let followWebhook: any;

  const post = (who: typeof owner, relay: string, body: unknown) => call(who, 'POST', `/channels/relay/${relay}/transmissions`, body);
  const publish = (who: typeof owner, relay: string, id: string) => call(who, 'POST', `/channels/relay/${relay}/transmissions/${id}/publish`);
  const copies = async (relay: string, sourceId: string) =>
    ((await call(follower, 'GET', `/channels/relay/${relay}/transmissions`)).json().transmissions as any[]).filter((t) => t.crosspost?.transmissionId === sourceId);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await seedPeople(db, people);
    newsBeacon = (await call(owner, 'POST', '/beacons', { name: 'Daily Planet', isDiscoverable: true })).json().beacon.id;
    news = (await call(owner, 'POST', `/beacons/${newsBeacon}/relays`, { name: 'news', type: 'text', isAnnouncement: true })).json().relay.id;
    secretNews = (await call(owner, 'POST', `/beacons/${newsBeacon}/relays`, { name: 'staff-news', type: 'text', isAnnouncement: true })).json().relay.id;
    everyoneRole = (await call(owner, 'GET', `/beacons/${newsBeacon}/clearances`)).json().clearances.find((c: any) => c.position === 0).id;
    await call(owner, 'PUT', `/beacons/${newsBeacon}/relays/${secretNews}/overwrites/${everyoneRole}`, { targetType: 'clearance', allow: '0', deny: VIEW });
    general = (await call(owner, 'GET', `/beacons/${newsBeacon}/relays`)).json().relays.find((r: any) => r.type === 'text' && !r.isAnnouncement).id;
    for (const p of [poster, reader, follower]) await call(p, 'POST', `/beacons/${newsBeacon}/join`);
    // The reader can see the news relay but not send there.
    await call(owner, 'PUT', `/beacons/${newsBeacon}/relays/${news}/overwrites/${reader.id}`, { targetType: 'transmitter', allow: '0', deny: PERMISSIONS.SEND_TRANSMISSIONS.toString() });

    home = (await call(follower, 'POST', '/beacons', { name: 'Fan Club', isDiscoverable: true })).json().beacon.id;
    feed = (await call(follower, 'GET', `/beacons/${home}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
    await call(helper, 'POST', `/beacons/${home}/join`);
    outsiderBeacon = (await call(outsider, 'POST', '/beacons', { name: 'Elsewhere' })).json().beacon.id;
    outsiderRelay = (await call(outsider, 'GET', `/beacons/${outsiderBeacon}/relays`)).json().relays.find((r: any) => r.type === 'text').id;

    const res = await call(follower, 'POST', `/relays/${news}/followers`, { targetRelayId: feed });
    expect(res.statusCode).toBe(201);
    followWebhook = res.json().webhook;
  });

  afterAll(async () => {
    await cleanupPeople(db, people);
    await app.close();
  });

  it('following: only relays you can see, only into relays where you hold Manage Webhooks, never across beacons by id', async () => {
    if (!db) return;
    const follow = (who: typeof owner, source: string, target: string) => call(who, 'POST', `/relays/${source}/followers`, { targetRelayId: target });
    // A private announcement relay: as unknown to non-staff as a missing one.
    expect((await follow(follower, secretNews, feed)).statusCode).toBe(404);
    expect((await follow(follower, '803756946623539999', feed)).statusCode).toBe(404);
    // Someone not in the news beacon cannot follow it at all.
    expect((await follow(outsider, news, outsiderRelay)).statusCode).toBe(404);
    // A member of the follower's beacon without Manage Webhooks.
    await call(helper, 'POST', `/beacons/${newsBeacon}/join`);
    expect((await follow(helper, news, feed)).json().code).toBe('MISSING_PERMISSIONS');
    // Into a relay of a beacon you are not in (a guessed id), or a voice relay, or the source itself.
    expect((await follow(follower, news, outsiderRelay)).json().code).toBe('UNKNOWN_TARGET');
    const voice = (await call(follower, 'GET', `/beacons/${home}/relays`)).json().relays.find((r: any) => r.type !== 'text' && r.type !== 'category');
    if (voice) expect((await follow(follower, news, voice.id)).json().code).toBe('UNKNOWN_TARGET');
    expect((await follow(owner, news, news)).json().code).toBe('SAME_RELAY');
    // Malformed ids and extra keys.
    expect((await call(follower, 'POST', `/relays/abc/followers`, { targetRelayId: feed })).statusCode).toBe(400);
    expect((await call(follower, 'POST', `/relays/${news}/followers`, { targetRelayId: 'abc' })).statusCode).toBe(400);
    const extra = await call(follower, 'POST', `/relays/${news}/followers`, { targetRelayId: feed, sourceRelayId: secretNews, token: 'x' });
    expect([400, 409]).toContain(extra.statusCode);
    // Its token is never shown, and no other webhook view reveals it either.
    expect(followWebhook.token).toBeUndefined();
    expect(followWebhook.url).toBeUndefined();
    const listed = await call(follower, 'GET', `/relays/${feed}/webhooks`);
    expect(listed.json().webhooks.find((w: any) => w.id === followWebhook.id)).toMatchObject({ sourceRelayId: news });
    expect(listed.body).not.toMatch(/"token"|tokenHash|"url"/);
  });

  it('a follower webhook cannot be given a URL, executed, or moved out of its beacon', async () => {
    if (!db) return;
    expect((await call(follower, 'POST', `/webhooks/${followWebhook.id}/reset-token`)).json().code).toBe('FOLLOWER_WEBHOOK');
    // Execute with its id and guessed tokens.
    for (const token of ['x', '', 'undefined', 'null', '0'.repeat(64)]) {
      const res = await app.inject({ method: 'POST', url: `/api/v1/webhooks/${followWebhook.id}/${token}`, payload: { content: 'spoofed announcement' } });
      expect([400, 404], token).toContain(res.statusCode);
    }
    // Moving it into another beacon's relay.
    expect((await call(follower, 'PATCH', `/webhooks/${followWebhook.id}`, { relayId: outsiderRelay })).statusCode).toBe(404);
    // Someone without Manage Webhooks in its relay cannot touch it.
    for (const [method, url, body] of [
      ['PATCH', `/webhooks/${followWebhook.id}`, { name: 'Hijacked' }],
      ['DELETE', `/webhooks/${followWebhook.id}`, undefined],
      ['POST', `/webhooks/${followWebhook.id}/reset-token`, undefined],
    ] as const) {
      expect((await call(helper, method, url, body)).statusCode, `${method} ${url}`).toBe(403);
      expect((await call(outsider, method, url, body)).statusCode, `${method} ${url}`).toBe(404);
    }
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, followWebhook.id)).limit(1);
    expect(row).toMatchObject({ relayId: feed, sourceRelayId: news });
  });

  it('publishing: your own (with Send) or anyone’s with Manage Transmissions; never cross-relay ids', async () => {
    if (!db) return;
    const mine = (await post(poster, news, { content: 'poster’s own scoop' })).json().transmission;
    const owners = (await post(owner, news, { content: 'owner’s post' })).json().transmission;
    // The poster cannot publish the owner's post; a reader cannot publish anything.
    expect((await publish(poster, news, owners.id)).json().code).toBe('MISSING_PERMISSIONS');
    expect((await publish(reader, news, owners.id)).json().code).toBe('MISSING_PERMISSIONS');
    // An outsider gets the same answer as for a relay that does not exist.
    expect((await publish(outsider, news, owners.id)).statusCode).toBe(404);
    // A transmission id from another relay, under this relay's URL.
    const elsewhere = (await post(owner, general, { content: 'general chatter' })).json().transmission;
    expect((await publish(owner, news, elsewhere.id)).statusCode).toBe(404);
    // Its own: fine.
    expect((await publish(poster, news, mine.id)).statusCode).toBe(200);
    expect(await copies(feed, mine.id)).toHaveLength(1);
    // Once only.
    expect((await publish(owner, news, mine.id)).json().code).toBe('ALREADY_PUBLISHED');
    // A member who lost Send cannot publish what they wrote earlier.
    const before = (await post(reader, general, { content: 'x' })).json().transmission;
    expect((await publish(reader, general, before.id)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('polls, system messages and webhook/bot posts by others are not publishable by members', async () => {
    if (!db) return;
    const poll = (await post(owner, news, { poll: { question: 'Best planet?', answers: [{ text: 'Mars' }, { text: 'Venus' }] } })).json().transmission;
    expect((await publish(owner, news, poll.id)).json().code).toBe('NOT_PUBLISHABLE');
    // Pinning makes a system message; publishing it is refused.
    const pinned = (await post(owner, news, { content: 'pin me' })).json().transmission;
    await call(owner, 'PUT', `/transmissions/${pinned.id}/pin`);
    const [system] = await db.select().from(transmissions).where(and(eq(transmissions.relayId, news), eq(transmissions.type, 'system_pin'))).limit(1);
    if (system) expect((await publish(owner, news, system.id)).json().code).toBe('NOT_PUBLISHABLE');
    const sys = (await call(owner, 'GET', `/channels/relay/${news}/transmissions`)).json().transmissions.filter((t: any) => t.type !== 'default' && t.type !== 'reply');
    for (const t of sys) expect((await publish(owner, news, t.id)).statusCode, t.type).toBe(400);
    // A webhook's post can only be published with Manage Transmissions.
    const hook = (await call(owner, 'POST', `/relays/${news}/webhooks`, { name: 'Wire' })).json().webhook;
    const wired = (await app.inject({ method: 'POST', url: `/api/v1/webhooks/${hook.id}/${hook.token}`, payload: { content: 'from the wire' } })).json().transmission;
    expect((await publish(poster, news, wired.id)).json().code).toBe('MISSING_PERMISSIONS');
  });

  it('copies never ping: no user, role, @everyone or @here mentions, and no mention counts', async () => {
    if (!db) return;
    const roleId = (await call(follower, 'POST', `/beacons/${home}/clearances`, { name: 'Pingable', mentionable: true })).json().clearance?.id ?? '803756946623539990';
    const content = `Breaking! @everyone @here <@${helper.id}> <@${follower.id}> <@&${roleId}> <@&${everyoneRole}>`;
    const t = (await post(owner, news, { content })).json().transmission;
    const before = (await call(helper, 'GET', '/read-states')).json();
    expect((await publish(owner, news, t.id)).statusCode).toBe(200);
    const [copy] = await copies(feed, t.id);
    expect(copy).toMatchObject({ content, mentions: [] });
    expect(copy.mentionEveryone ?? false).toBe(false);
    expect(copy.mentionRoles ?? []).toEqual([]);
    const after = (await call(helper, 'GET', '/read-states')).json();
    const count = (rs: any) => (Array.isArray(rs) ? rs : (rs.readStates ?? rs.states ?? [])).find((s: any) => s.channelId === feed)?.mentionCount ?? 0;
    expect(count(after)).toBe(count(before));
    // Nor in the inbox's Mentions tab.
    const mentions = (await call(helper, 'GET', '/users/@me/mentions')).json().mentions;
    expect(mentions.find((m: any) => m.transmission.id === copy.id)).toBeUndefined();
    // Control: an ordinary mention in the same relay is counted, so the check above measures something.
    await post(follower, feed, { content: `hey <@${helper.id}>` });
    expect(count((await call(helper, 'GET', '/read-states')).json())).toBe(count(after) + 1);
  });

  it('publishing is limited to 10 an hour per relay', async () => {
    if (!db) return;
    const burst = (await call(owner, 'POST', `/beacons/${newsBeacon}/relays`, { name: 'burst', type: 'text', isAnnouncement: true })).json().relay.id;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = (await post(owner, burst, { content: `bulletin ${i}` })).json().transmission;
      statuses.push((await publish(owner, burst, t.id)).statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Unpublished posts stay unpublished (no copy, no publishedAt) when refused.
    const last = (await call(owner, 'GET', `/channels/relay/${burst}/transmissions`)).json().transmissions.find((t: any) => t.content === 'bulletin 11');
    expect(last.publishedAt ?? null).toBeNull();
  });

  // SECURITY BUG (low): publishing is check-then-act. announcements.routes.ts reads t.publishedAt,
  // then (after the rate-limit call) sets it with an unconditional UPDATE, so concurrent publish
  // requests for the same transmission all pass the ALREADY_PUBLISHED check and each one posts a
  // copy into every follower relay (spam into other beacons; each also burns the 10/hour budget).
  // Fix: make the claim atomic, e.g. UPDATE transmissions SET published_at = now() WHERE id = $1 AND
  // published_at IS NULL RETURNING *, and answer ALREADY_PUBLISHED when no row comes back.
  it('concurrent publishes of one transmission deliver exactly one copy', async () => {
    if (!db) throw new Error('needs the database');
    const race = (await call(owner, 'POST', `/beacons/${newsBeacon}/relays`, { name: 'race', type: 'text', isAnnouncement: true })).json().relay.id;
    await call(follower, 'POST', `/relays/${race}/followers`, { targetRelayId: feed });
    const t = (await post(owner, race, { content: 'race me' })).json().transmission;
    const results = await Promise.all(Array.from({ length: 6 }, () => publish(owner, race, t.id)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(await copies(feed, t.id)).toHaveLength(1);
  });

  it('names and content from the source beacon are stored as text, not interpreted', async () => {
    if (!db) return;
    const evil = (await call(owner, 'POST', '/beacons', { name: '<img src=x onerror=alert(1)>', isDiscoverable: true })).json().beacon.id;
    const relay = (await call(owner, 'POST', `/beacons/${evil}/relays`, { name: 'news', type: 'text', isAnnouncement: true })).json().relay.id;
    await call(follower, 'POST', `/beacons/${evil}/join`);
    const hook = (await call(follower, 'POST', `/relays/${relay}/followers`, { targetRelayId: feed })).json().webhook;
    // The webhook name is exactly the text (escaping is the client's job, see tests/ui/security-xss.spec.ts).
    expect(hook.name).toBe('<img src=x onerror=alert(1)> #news');
    expect(hook.name.length).toBeLessThanOrEqual(80);
  });
});
