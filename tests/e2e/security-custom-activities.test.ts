import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { checkActivityUrl, isOwnSite } from '../../apps/api-service/src/lib/app-activities.js';
import { PERMISSIONS } from '@subspace/constants';
import { person, caller, seedPeople, cleanupPeople, captureBus } from '../support/security.js';

/**
 * Security: custom Activities (third-party iframe apps in comm-links). URL registration bypasses,
 * approval bypasses by role, authorization codes, and the ACTIVITY_MESSAGE relay.
 * The client-side bridge (postMessage) is covered by tests/ui/security-activities.spec.ts.
 */
describe('Security: custom activity URL rules', () => {
  const env = { ...process.env };
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_ORIGIN = 'https://chat.subspace.test';
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = 'localhost,127.0.0.1';
  });
  afterAll(() => {
    process.env.NODE_ENV = env.NODE_ENV;
    process.env.PUBLIC_ORIGIN = env.PUBLIC_ORIGIN;
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = env.UNFURL_ALLOW_PRIVATE_HOSTS;
  });
  const refusedAs = async (url: string, why: RegExp, host?: string) => {
    const r = await checkActivityUrl(url, host);
    expect(r.ok, url).toBe(false);
    if (!r.ok) expect(r.error, url).toMatch(why);
  };

  it('our own origin is refused however it is spelled: case, trailing dot, port, IDN/fullwidth, subdomains', async () => {
    const OWN = /own domain/;
    for (const u of [
      'https://CHAT.SUBSPACE.TEST/a',
      'https://chat.subspace.test./a',
      'https://chat.subspace.test:8443/a',
      'https://ｃｈａｔ.subspace.test/a', // fullwidth letters normalise to ASCII
      'https://chat.ＳＵＢＳＰＡＣＥ.test/a',
      'https://subspace.test/a',
      'https://a.b.c.subspace.test/a',
      'https://SUBSPACE.TEST./a',
    ]) {
      await refusedAs(u, OWN);
    }
    // Credentials in front of our host are refused before anything else.
    await refusedAs('https://evil.example@chat.subspace.test/a', /username and password/);
    await refusedAs('https://chat.subspace.test@1.1.1.1/a', /username and password/);
    // Look-alikes that are another site are not ours (they are judged on their own merits).
    expect(isOwnSite('subspace.test.evil.example')).toBe(false);
    expect(isOwnSite('evilsubspace.test')).toBe(false);
  });

  it('schemes, private and numeric addresses are refused', async () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'blob:https://1.1.1.1/x', 'ftp://1.1.1.1/', 'ws://1.1.1.1/', 'file:///C:/x.html', 'about:blank', '//1.1.1.1/a', 'https://1.1.1.1/a#x']) {
      expect((await checkActivityUrl(u)).ok, u).toBe(false);
    }
    const PRIVATE = /not public/;
    for (const u of ['https://2130706434/', 'https://0x7f000002/', 'https://0177.0.0.2/', 'https://127.2/', 'https://[::ffff:127.0.0.2]/', 'https://[::ffff:a9fe:a9fe]/', 'https://[fd00::1]/', 'https://169.254.169.254/', 'https://10.0.0.1/', 'https://0.0.0.0/', 'https://[::]/']) {
      await refusedAs(u, PRIVATE);
    }
    // http only to loopback, and never in production.
    await refusedAs('http://1.1.1.1/a', /https/);
    await refusedAs('http://localhost.evil.example/a', /https/);
    process.env.NODE_ENV = 'production';
    try {
      await refusedAs('http://localhost:4180/a', /https/);
      await refusedAs('https://[::1]/a', /https|not public/);
    } finally {
      process.env.NODE_ENV = 'test';
    }
    expect(await checkActivityUrl('https://1.1.1.1/activity/?x=1')).toEqual({ ok: true, url: 'https://1.1.1.1/activity/?x=1' });
    expect((await checkActivityUrl('https://1.1.1.1/' + 'a'.repeat(600))).ok).toBe(false);
  });

  // Fixed (was a security bug): with PUBLIC_ORIGIN unset nothing counted as our own site.
  it('with PUBLIC_ORIGIN unset, the request host and WEBAUTHN_ORIGINS still count, and production refuses outright', async () => {
    const saved = { p: process.env.PUBLIC_ORIGIN, w: process.env.WEBAUTHN_ORIGINS, n: process.env.NODE_ENV };
    process.env.PUBLIC_ORIGIN = '';
    delete process.env.WEBAUTHN_ORIGINS;
    try {
      expect(isOwnSite('chat.subspace.test')).toBe(false);
      expect(isOwnSite('chat.subspace.test', ['app.subspace.test'])).toBe(true);
      await refusedAs('https://chat.subspace.test/a', /own domain/, 'app.subspace.test');
      process.env.WEBAUTHN_ORIGINS = 'https://subspace.test';
      expect(isOwnSite('chat.subspace.test')).toBe(true);
      delete process.env.WEBAUTHN_ORIGINS;
      process.env.NODE_ENV = 'production';
      await refusedAs('https://1.1.1.1/a', /no PUBLIC_ORIGIN/);
      expect((await checkActivityUrl('https://1.1.1.1/a', 'app.subspace.test')).ok).toBe(true);
    } finally {
      process.env.PUBLIC_ORIGIN = saved.p;
      if (saved.w === undefined) delete process.env.WEBAUTHN_ORIGINS;
      else process.env.WEBAUTHN_ORIGINS = saved.w;
      process.env.NODE_ENV = saved.n;
    }
  });
});

describe('Security: custom activity approval, codes and messages', () => {
  let app: FastifyInstance;
  let db: any;
  let redis: any;
  const env = { ...process.env };
  const dev = person('803756946623560001', 'sca_dev');
  const teamDev = person('803756946623560002', 'sca_teamdev');
  const viewer = person('803756946623560003', 'sca_viewer');
  const pending = person('803756946623560004', 'sca_pending');
  const guest = person('803756946623560005', 'sca_guest');
  const lurker = person('803756946623560006', 'sca_lurker'); // in the beacon, not in voice
  const blocked = person('803756946623560007', 'sca_blocked'); // in voice, without Use Activities
  const root = person('803756946623560008', 'sca_root', 3);
  const people = [dev, teamDev, viewer, pending, guest, lurker, blocked, root];
  const { call } = caller(() => app);
  const form = (fields: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/v1/oauth2/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString() });
  const inVoice = (x: typeof dev, relayId: string | null) => (relayId ? redis.hset('voice:relay', x.id, relayId) : redis.hdel('voice:relay', x.id));

  let appId = '';
  let clientSecret = '';
  let beaconId = '';
  let commLink = '';
  const acts = () => `/relays/${commLink}/activities`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_ORIGIN = 'https://chat.subspace.test';
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = 'localhost,127.0.0.1';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    redis = (app as any).redis;
    if (!db || !redis) return;
    await seedPeople(db, people);
    const created = (await call(dev, 'POST', '/applications', { name: 'Hex Board' })).json();
    appId = created.application.id;
    clientSecret = created.clientSecret;
    const team = (await call(dev, 'POST', '/teams', { name: 'Hex Crew' })).json().team.id;
    for (const [who, role] of [
      [teamDev, 'developer'],
      [viewer, 'read_only'],
      [pending, 'developer'],
    ] as const) {
      await call(dev, 'POST', `/teams/${team}/members`, { username: who.username, discriminator: '0420', role });
      if (who !== pending) await call(who, 'POST', `/teams/${team}/accept`);
    }
    await call(dev, 'POST', `/applications/${appId}/team`, { teamId: team });
    expect((await call(teamDev, 'PUT', `/applications/${appId}/activity`, { name: 'Hex Board', url: 'https://1.1.1.1/hex/', maxParticipants: 4 })).statusCode).toBe(201);

    beaconId = (await call(dev, 'POST', '/beacons', { name: 'Hex Hall', isDiscoverable: true })).json().beacon.id;
    commLink = (await call(dev, 'GET', `/beacons/${beaconId}/relays`)).json().relays.find((r: any) => r.type === 'comm_link').id;
    for (const p of [teamDev, viewer, pending, guest, lurker, blocked]) await call(p, 'POST', `/beacons/${beaconId}/join`);
    await call(dev, 'PUT', `/beacons/${beaconId}/relays/${commLink}/overwrites/${blocked.id}`, { targetType: 'transmitter', allow: '0', deny: PERMISSIONS.USE_ACTIVITIES.toString() });
    for (const p of [dev, teamDev, viewer, pending, guest, blocked]) await inVoice(p, commLink);
  });

  afterAll(async () => {
    process.env.NODE_ENV = env.NODE_ENV;
    process.env.PUBLIC_ORIGIN = env.PUBLIC_ORIGIN;
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = env.UNFURL_ALLOW_PRIVATE_HOSTS;
    if (redis) {
      for (const p of people) await redis.hdel('voice:relay', p.id);
      await redis.del(`activities:${commLink}`);
      for (const p of people) await redis.del(`activity:authorize:${p.id}`);
    }
    await cleanupPeople(db, people);
    await app.close();
  });

  it('before approval: read-only members, pending invitees and outsiders cannot launch, join, authorize or broadcast', async () => {
    if (!db || !redis) return;
    for (const who of [viewer, pending, guest]) {
      expect((await call(who, 'POST', acts(), { kind: 'app', appId })).json().code, who.username).toBe('ACTIVITY_NOT_APPROVED');
      expect((await call(who, 'GET', '/activities/apps')).json().activities.map((a: any) => a.id), who.username).not.toContain(appId);
    }
    const a = (await call(teamDev, 'POST', acts(), { kind: 'app', appId })).json().activity;
    for (const who of [viewer, pending, guest]) {
      expect((await call(who, 'POST', `${acts()}/${a.id}/join`)).json().code, who.username).toBe('ACTIVITY_NOT_APPROVED');
      expect((await call(who, 'POST', `${acts()}/${a.id}/authorize`, { scopes: ['identify'], consent: true })).json().code, who.username).toBe('NOT_IN_ACTIVITY');
      expect((await call(who, 'POST', `${acts()}/${a.id}/events`, { type: 'message', data: { payload: 1 } })).json().code, who.username).toBe('NOT_IN_ACTIVITY');
    }
    // Pending invitees cannot read or edit the Activity's settings either.
    expect((await call(pending, 'GET', `/applications/${appId}/activity`)).statusCode).toBe(404);
    expect((await call(pending, 'PUT', `/applications/${appId}/activity`, { name: 'Hex Board', url: 'https://1.0.0.1/' })).statusCode).toBe(404);
    // Someone without Use Activities, or not in the comm-link, cannot even get that far.
    expect((await call(blocked, 'POST', `${acts()}/${a.id}/join`)).json().code).toBe('MISSING_PERMISSIONS');
    expect((await call(lurker, 'POST', `${acts()}/${a.id}/join`)).json().code).toBe('NOT_IN_COMM_LINK');
    // Watchers of the comm-link see which app it is, never its URL or the participants' profiles.
    const seen = (await call(lurker, 'GET', acts())).json().activities.find((x: any) => x.id === a.id);
    expect(seen.app.url).toBeUndefined();
    expect(seen.people).toBeUndefined();
    expect(seen.watch).toBeUndefined();
    await call(teamDev, 'POST', `${acts()}/${a.id}/leave`);
  });

  it('a URL change takes the approval away, a no-op re-save keeps it, and swapping apps is not possible by id', async () => {
    if (!db || !redis) return;
    await call(root, 'PUT', `/console/activities/${appId}/approval`);
    const approved = async () => (await call(dev, 'GET', `/applications/${appId}/activity`)).json().activity.approved;
    expect(await approved()).toBe(true);
    // Same URL written differently but normalising to the same string keeps it (it is the same page).
    await call(dev, 'PUT', `/applications/${appId}/activity`, { name: 'Hex Board', url: 'HTTPS://1.1.1.1/hex/' });
    expect(await approved()).toBe(true);
    // Any real change loses it: path, query, host, port.
    for (const url of ['https://1.1.1.1/hex/?v=2', 'https://1.1.1.1/hex2/', 'https://1.1.1.1:8443/hex/', 'https://1.0.0.1/hex/']) {
      await call(root, 'PUT', `/console/activities/${appId}/approval`);
      await call(dev, 'PUT', `/applications/${appId}/activity`, { name: 'Hex Board', url });
      expect(await approved(), url).toBe(false);
    }
    await call(dev, 'PUT', `/applications/${appId}/activity`, { name: 'Hex Board', url: 'https://1.1.1.1/hex/' });
    // The approval cannot be written through the developer route.
    await call(dev, 'PUT', `/applications/${appId}/activity`, { name: 'Hex Board', url: 'https://1.1.1.1/hex/', approved: true, approvedAt: new Date().toISOString() } as any);
    expect(await approved()).toBe(false);
    // Only staff approve, and a malformed app id is not a wildcard.
    for (const who of [dev, teamDev, viewer]) expect((await call(who, 'PUT', `/console/activities/${appId}/approval`)).statusCode).toBe(403);
    expect((await call(root, 'PUT', '/console/activities/abc/approval')).statusCode).toBeGreaterThanOrEqual(400);
    expect((await call(root, 'PUT', '/console/activities/803756946623569999/approval')).statusCode).toBe(404);
    await call(root, 'PUT', `/console/activities/${appId}/approval`);
  });

  it('authorization codes: bound to the app and the person, need no redirect_uri, single use, and never minted for unapproved apps', async () => {
    if (!db || !redis) return;
    await redis.del(`activity:authorize:${guest.id}`);
    const a = (await call(guest, 'POST', acts(), { kind: 'app', appId })).json().activity;
    const code = async () => (await call(guest, 'POST', `${acts()}/${a.id}/authorize`, { scopes: ['identify'], consent: true })).json().code as string;
    // Scopes: only the known ones, no prototype names, no duplicates sneaking through.
    for (const scopes of [['__proto__'], ['toString'], ['constructor'], ['IDENTIFY'], ['identify ', 'email'], [], Array(11).fill('identify')]) {
      const res = await call(guest, 'POST', `${acts()}/${a.id}/authorize`, { scopes, consent: true });
      expect(res.statusCode, JSON.stringify(scopes)).toBe(400);
    }
    // Another app's secret cannot redeem it; a wrong client id with the right secret neither.
    const other = (await call(guest, 'POST', '/applications', { name: 'Code Thief' })).json();
    expect((await form({ grant_type: 'authorization_code', code: await code(), client_id: other.application.id, client_secret: other.clientSecret })).json().error).toBe('invalid_grant');
    expect((await form({ grant_type: 'authorization_code', code: await code(), client_id: other.application.id, client_secret: clientSecret })).json().error).toBe('invalid_client');
    // A code redeemed is for the person who asked, and only once.
    const c = await code();
    const tok = await form({ grant_type: 'authorization_code', code: c, client_id: appId, client_secret: clientSecret });
    expect(tok.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/oauth2/@me', headers: { authorization: `Bearer ${tok.json().access_token}` } });
    expect(me.json().user.id).toBe(guest.id);
    expect((await form({ grant_type: 'authorization_code', code: c, client_id: appId, client_secret: clientSecret })).json().error).toBe('invalid_grant');
    // An app access token is not a session: it cannot call the rest of the API.
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/@me/bookmarks', headers: { authorization: `Bearer ${tok.json().access_token}` } })).statusCode).toBe(401);
    // Withdraw the approval: a participant cannot mint more codes.
    await call(root, 'DELETE', `/console/activities/${appId}/approval`);
    expect((await call(guest, 'POST', `${acts()}/${a.id}/authorize`, { scopes: ['identify'], consent: true })).json().code).toBe('ACTIVITY_NOT_APPROVED');
    await call(root, 'PUT', `/console/activities/${appId}/approval`);
    await call(guest, 'POST', `${acts()}/${a.id}/leave`);
    await call(guest, 'DELETE', `/applications/${other.application.id}`);
  });

  it('ACTIVITY_MESSAGE goes only to the other participants, is JSON-only and capped at 4096 bytes', async () => {
    if (!db || !redis) return;
    const a = (await call(teamDev, 'POST', acts(), { kind: 'app', appId })).json().activity;
    await call(guest, 'POST', `${acts()}/${a.id}/join`);
    const send = (who: typeof dev, payload: unknown) => call(who, 'POST', `${acts()}/${a.id}/events`, { type: 'message', data: { payload } });
    const events = await captureBus(() => send(teamDev, { hello: 'world' }));
    const msgs = events.filter((e) => e.type === 'ACTIVITY_MESSAGE');
    expect(events.length).toBeGreaterThan(0);
    {
      expect(msgs).toHaveLength(1);
      expect(msgs[0].audience).toEqual([guest.id]);
      expect(msgs[0]).toMatchObject({ from: teamDev.id, payload: { hello: 'world' } });
    }
    // Bytes, not characters: 1100 four-byte characters are over the cap.
    expect((await send(teamDev, '🛰'.repeat(1100))).json().code).toBe('ACTIVITY_MESSAGE_TOO_LARGE');
    expect((await send(teamDev, 'x'.repeat(4000))).statusCode).toBe(200);
    // Non-JSON bodies and other event types for an app activity.
    const raw = await app.inject({ method: 'POST', url: `/api/v1${acts()}/${a.id}/events`, headers: { ...caller(() => app).auth(teamDev), 'content-type': 'text/plain' }, payload: 'payload' });
    expect(raw.statusCode).toBeGreaterThanOrEqual(400);
    for (const type of ['stroke', 'clear', 'watch']) expect((await call(teamDev, 'POST', `${acts()}/${a.id}/events`, { type, data: { points: [0, 0, 1, 1] } })).statusCode, type).toBe(400);
    expect((await call(teamDev, 'POST', `${acts()}/${a.id}/events`, { type: 'message', data: 'x' })).statusCode).toBe(400);
    // Someone in the comm-link but not in this activity neither sends nor is addressed.
    await inVoice(lurker, commLink);
    expect((await send(lurker, 1)).json().code).toBe('NOT_IN_ACTIVITY');
    const again = await captureBus(() => send(guest, 'to the host'));
    expect(again.filter((x) => x.type === 'ACTIVITY_MESSAGE')).toHaveLength(1);
    for (const e of again.filter((x) => x.type === 'ACTIVITY_MESSAGE')) expect(e.audience).toEqual([teamDev.id]);
    // The participants event with public profiles goes to participants only.
    const joinEvents = await captureBus(() => call(lurker, 'POST', `${acts()}/${a.id}/join`));
    expect(joinEvents.filter((x) => x.type === 'ACTIVITY_EVENT' && x.event === 'participants').length).toBeGreaterThan(0);
    for (const e of joinEvents.filter((x) => x.type === 'ACTIVITY_EVENT' && x.event === 'participants')) {
      expect(e.audience.sort()).toEqual([teamDev.id, guest.id, lurker.id].sort());
      expect(JSON.stringify(e.data.people)).not.toMatch(/email|passwordHash|phone/);
    }
    await inVoice(lurker, null);
    for (const p of [teamDev, guest, lurker]) await call(p, 'POST', `${acts()}/${a.id}/leave`);
  });

  it('kind and ids are validated: no app activity without an app, no ids from another comm-link', async () => {
    if (!db || !redis) return;
    expect((await call(guest, 'POST', acts(), { kind: 'app', appId: 'abc' })).statusCode).toBe(400);
    expect((await call(guest, 'POST', acts(), { kind: 'game', appId })).statusCode).toBe(400);
    expect((await call(guest, 'POST', acts(), { kind: 'app', appId, url: 'https://evil.example/' })).json().activity?.app?.url ?? 'https://1.1.1.1/hex/').toBe('https://1.1.1.1/hex/');
    await call(guest, 'POST', `${acts()}/${(await call(guest, 'GET', acts())).json().activities.find((x: any) => x.participants?.includes(guest.id))?.id}/leave`);
    // An activity id from this comm-link under another comm-link's URL.
    const other = (await call(dev, 'POST', `/beacons/${beaconId}/relays`, { name: 'Other Link', type: 'comm_link' })).json().relay.id;
    const a = (await call(teamDev, 'POST', acts(), { kind: 'app', appId })).json().activity;
    await inVoice(guest, other);
    expect((await call(guest, 'POST', `/relays/${other}/activities/${a.id}/join`)).json().code).toBe('NO_ACTIVITY');
    expect((await call(guest, 'POST', `/relays/${other}/activities/${a.id}/authorize`, { scopes: ['identify'], consent: true })).json().code).toBe('NO_ACTIVITY');
    await inVoice(guest, commLink);
    await call(teamDev, 'POST', `${acts()}/${a.id}/leave`);
  });
});
