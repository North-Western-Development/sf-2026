import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, devTeams, devTeamMembers, oauthApps, staffAuditLog, eq, inArray } from '@subspace/database';

/**
 * Custom Activities: developers register a page, staff approve it, people launch it in a
 * comm-link, and sdk.authorize() gets a code bound to the app that only its backend can redeem.
 */
describe('Custom activities', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let redis: any;
  const u = (n: number, username: string) => ({ id: `80245694662349${9000 + n}`, username });
  const dev = u(1, 'ca_dev');
  const teamDev = u(2, 'ca_teamdev');
  const teamViewer = u(3, 'ca_viewer');
  const guest = u(4, 'ca_guest');
  const shy = u(5, 'ca_shy');
  const root = u(6, 'ca_root');
  const people = [dev, teamDev, teamViewer, guest, shy, root];
  type U = typeof dev;
  const auth = (x: U) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: x.id, username: x.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, x: U, payload?: unknown) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(x), payload: payload as any });
  const form = (fields: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/v1/oauth2/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString() });
  const inVoice = (x: U, relayId: string | null) => (relayId ? redis.hset('voice:relay', x.id, relayId) : redis.hdel('voice:relay', x.id));
  const env = { ...process.env };

  let appId = '';
  let clientSecret = '';
  let otherAppId = '';
  let otherSecret = '';
  let beaconId = '';
  let commLink = '';
  const URL_A = 'https://1.1.1.1/activity/';
  const URL_B = 'https://1.0.0.1/activity/';
  const acts = () => `/relays/${commLink}/activities`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PUBLIC_ORIGIN = 'https://chat.subspace.test';
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = 'localhost,127.0.0.1';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    redis = (app as any).redis;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, dev.id));
    await db.delete(transmitters).where(inArray(transmitters.id, people.map((p) => p.id)));
    for (const p of people) {
      await db.insert(transmitters).values({
        id: p.id,
        username: p.username,
        email: `${p.username}@subspace.test`,
        passwordHash: 'x',
        displayName: p.username.toUpperCase(),
        avatarUrl: p === guest ? '/subspace-media/avatars/guest.png' : null,
        isEmailVerified: true,
        staffRank: p === root ? 3 : 0,
        createdAt: new Date(Date.now() - 30 * 86_400_000),
      });
    }
    const created = (await call('POST', '/applications', dev, { name: 'Star Counter' })).json();
    appId = created.application.id;
    clientSecret = created.clientSecret;
    const other = (await call('POST', '/applications', guest, { name: 'Somebody Else' })).json();
    otherAppId = other.application.id;
    otherSecret = other.clientSecret;
    // The app belongs to dev's team: teamDev develops it, teamViewer can only look.
    const [team] = await db.insert(devTeams).values({ name: 'Counter Crew', ownerId: dev.id }).returning();
    await db.insert(devTeamMembers).values([
      { teamId: team.id, transmitterId: teamDev.id, role: 'developer', acceptedAt: new Date() },
      { teamId: team.id, transmitterId: teamViewer.id, role: 'read_only', acceptedAt: new Date() },
    ]);
    await db.update(oauthApps).set({ teamId: team.id }).where(eq(oauthApps.id, appId));

    beaconId = (await call('POST', '/beacons', dev, { name: 'Arcade', isDiscoverable: true })).json().beacon.id;
    commLink = (await call('GET', `/beacons/${beaconId}/relays`, dev)).json().relays.find((r: any) => r.type === 'comm_link').id;
    for (const p of [teamDev, teamViewer, guest, shy]) await call('POST', `/beacons/${beaconId}/join`, p);
  });

  afterAll(async () => {
    process.env.NODE_ENV = env.NODE_ENV;
    process.env.PUBLIC_ORIGIN = env.PUBLIC_ORIGIN;
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = env.UNFURL_ALLOW_PRIVATE_HOSTS;
    if (db) {
      for (const p of people) await redis?.hdel('voice:relay', p.id);
      await redis?.del(`activities:${commLink}`);
      await db.delete(staffAuditLog).where(eq(staffAuditLog.actorId, root.id));
      await db.delete(beacons).where(eq(beacons.ownerId, dev.id));
      await db.delete(transmitters).where(inArray(transmitters.id, people.map((p) => p.id)));
    }
    await app.close();
  });

  it('accepts only a public https page off our own site, and only from the team roles that may edit', async () => {
    if (!db) return;
    const put = (url: string, who: U = dev) => call('PUT', `/applications/${appId}/activity`, who, { name: 'Star Counter', url });
    const refused = async (url: string) => expect((await put(url)).json().code, url).toBe('INVALID_ACTIVITY_URL');
    await refused('http://example.com/activity');
    await refused('ftp://1.1.1.1/activity');
    await refused('https://chat.subspace.test/activity'); // our origin
    await refused('https://cdn.subspace.test/activity'); // same site: could toss cookies onto us
    await refused('https://subspace.test/activity');
    await refused('https://me:pw@1.1.1.1/activity');
    await refused('https://1.1.1.1/activity#frame_id=x');
    await refused('https://10.0.0.5/activity'); // private
    await refused('https://169.254.169.254/latest'); // link-local (cloud metadata)
    await refused('https://127.0.0.2/activity'); // loopback, not allow-listed for tests
    await refused('not a url');

    // In production http and loopback are out, whatever the test allow-list says.
    process.env.NODE_ENV = 'production';
    try {
      await refused('http://127.0.0.1:4180/activity');
      await refused('https://127.0.0.1/activity');
      await refused('https://localhost/activity');
    } finally {
      process.env.NODE_ENV = 'test';
    }
    // Outside production, http://localhost is fine for local development.
    expect((await put('http://127.0.0.1:4180/activity')).statusCode).toBe(201);

    // A read-only team member can look but not change it; strangers do not see the app at all.
    expect((await put(URL_A, teamViewer)).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call('GET', `/applications/${appId}/activity`, teamViewer)).json().activity).toMatchObject({ url: 'http://127.0.0.1:4180/activity', approved: false });
    expect((await call('GET', `/applications/${appId}/activity`, guest)).statusCode).toBe(404);
    expect((await put(URL_A, guest)).statusCode).toBe(404);

    const saved = await call('PUT', `/applications/${appId}/activity`, teamDev, { name: 'Star Counter', description: 'Count together', url: URL_A, maxParticipants: 3 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().activity).toMatchObject({ name: 'Star Counter', url: URL_A, maxParticipants: 3, approved: false });
    expect((await call('PUT', `/applications/${appId}/activity`, dev, { name: 'X', url: URL_A })).statusCode).toBe(400); // name too short
  });

  it('lets only the team launch it until staff approve it, and takes the approval away with a new URL', async () => {
    if (!db || !redis) return;
    for (const p of [dev, teamDev, teamViewer, guest]) await inVoice(p, commLink);
    const listed = async (who: U) => (await call('GET', '/activities/apps', who)).json().activities.map((a: any) => a.id);
    expect(await listed(guest)).not.toContain(appId);
    expect(await listed(teamViewer)).not.toContain(appId);
    expect((await call('GET', '/activities/apps', teamDev)).json().activities.find((a: any) => a.id === appId)).toMatchObject({ name: 'Star Counter', developer: 'Counter Crew', approved: false, origin: 'https://1.1.1.1' });

    expect((await call('POST', acts(), guest, { kind: 'app', appId })).json().code).toBe('ACTIVITY_NOT_APPROVED');
    expect((await call('POST', acts(), teamViewer, { kind: 'app', appId })).json().code).toBe('ACTIVITY_NOT_APPROVED');
    expect((await call('POST', acts(), guest, { kind: 'app', appId: '802456946623499999' })).json().code).toBe('UNKNOWN_ACTIVITY');
    expect((await call('POST', acts(), guest, { kind: 'app' })).json().code).toBe('UNKNOWN_ACTIVITY');

    // The team tests it; outsiders cannot join that test.
    const started = await call('POST', acts(), teamDev, { kind: 'app', appId });
    expect(started.statusCode).toBe(201);
    const activity = started.json().activity;
    expect(activity).toMatchObject({ kind: 'app', app: { id: appId, url: URL_A, approved: false }, people: [{ id: teamDev.id, username: teamDev.username }] });
    expect((await call('POST', `${acts()}/${activity.id}/join`, guest)).json().code).toBe('ACTIVITY_NOT_APPROVED');
    // Everyone else in the comm-link sees which app it is, but not its page.
    const seen = (await call('GET', acts(), guest)).json().activities.find((a: any) => a.id === activity.id);
    expect(seen.app).toEqual({ id: appId, name: 'Star Counter', iconUrl: null, developer: 'Counter Crew', approved: false, origin: 'https://1.1.1.1' });

    // Only staff with Manage Developers approve.
    expect((await call('PUT', `/console/activities/${appId}/approval`, dev)).statusCode).toBe(403);
    const approved = await call('PUT', `/console/activities/${appId}/approval`, root);
    expect(approved.statusCode).toBe(200);
    expect(approved.json().activities.find((a: any) => a.application.id === appId)).toMatchObject({ approved: true, url: URL_A });
    expect((await call('GET', '/console/audit-log', root)).json().entries[0]).toMatchObject({ action: 'activity.approve' });

    expect(await listed(guest)).toContain(appId);
    const joined = await call('POST', `${acts()}/${activity.id}/join`, guest);
    expect(joined.statusCode).toBe(200);
    expect(joined.json().activity.people.map((p: any) => p.id)).toEqual([teamDev.id, guest.id]);
    expect(joined.json().activity.people[1]).toEqual({ id: guest.id, username: guest.username, displayName: 'CA_GUEST', avatarUrl: '/subspace-media/avatars/guest.png' });
    // At most maxParticipants (3) in one instance.
    expect((await call('POST', `${acts()}/${activity.id}/join`, teamViewer)).statusCode).toBe(200);
    expect((await call('POST', `${acts()}/${activity.id}/join`, dev)).json().code).toBe('ACTIVITY_FULL');
    await call('POST', `${acts()}/${activity.id}/leave`, teamViewer);

    // Renaming keeps the approval; a new URL is a new page to review.
    await call('PUT', `/applications/${appId}/activity`, dev, { name: 'Star Counter 2', url: URL_A });
    expect((await call('GET', `/applications/${appId}/activity`, dev)).json().activity.approved).toBe(true);
    await call('PUT', `/applications/${appId}/activity`, dev, { name: 'Star Counter 2', url: URL_B });
    expect((await call('GET', `/applications/${appId}/activity`, dev)).json().activity).toMatchObject({ url: URL_B, approved: false });
    expect(await listed(guest)).not.toContain(appId);
    await call('POST', `${acts()}/${activity.id}/leave`, guest);
    expect((await call('POST', `${acts()}/${activity.id}/join`, guest)).json().code).toBe('ACTIVITY_NOT_APPROVED');
    expect((await call('POST', acts(), guest, { kind: 'app', appId })).json().code).toBe('ACTIVITY_NOT_APPROVED');

    // Withdrawing works the same way.
    await call('PUT', `/console/activities/${appId}/approval`, root);
    expect(await listed(guest)).toContain(appId);
    expect((await call('DELETE', `/console/activities/${appId}/approval`, root)).statusCode).toBe(200);
    expect(await listed(guest)).not.toContain(appId);

    // The last one out ends it, as with the built-in ones.
    await call('POST', `${acts()}/${activity.id}/leave`, teamDev);
    expect((await call('GET', acts(), guest)).json().activities.find((a: any) => a.id === activity.id)).toBeUndefined();
  });

  it('issues a single-use code bound to the app, the person and no redirect, after consent', async () => {
    if (!db || !redis) return;
    await call('PUT', `/console/activities/${appId}/approval`, root);
    await inVoice(shy, commLink);
    const activity = (await call('POST', acts(), guest, { kind: 'app', appId })).json().activity;
    const authorize = (who: U, body: unknown) => call('POST', `${acts()}/${activity.id}/authorize`, who, body);

    expect((await authorize(shy, { scopes: ['identify'], consent: true })).json().code).toBe('NOT_IN_ACTIVITY');
    expect((await authorize(guest, { scopes: ['identify', 'admin'], consent: true })).json().code).toBe('INVALID_SCOPE');
    // The client asks the person first: the API will not skip that unless they already agreed.
    expect((await authorize(guest, { scopes: ['identify'] })).json().code).toBe('CONSENT_REQUIRED');

    const code = async () => {
      const res = await authorize(guest, { scopes: ['identify'], consent: true });
      expect(res.statusCode).toBe(200);
      return res.json().code as string;
    };
    // Not with a redirect_uri (there was none), not by another app, and only once.
    expect((await form({ grant_type: 'authorization_code', code: await code(), client_id: appId, client_secret: clientSecret, redirect_uri: 'https://1.0.0.1/cb' })).json().error).toBe('invalid_grant');
    expect((await form({ grant_type: 'authorization_code', code: await code(), client_id: otherAppId, client_secret: otherSecret })).json().error).toBe('invalid_grant');
    expect((await form({ grant_type: 'authorization_code', code: await code(), client_id: appId, client_secret: 'wrong' })).json().error).toBe('invalid_client');
    const good = await code();
    const tokens = await form({ grant_type: 'authorization_code', code: good, client_id: appId, client_secret: clientSecret });
    expect(tokens.statusCode).toBe(200);
    expect(tokens.json()).toMatchObject({ token_type: 'Bearer', scope: 'identify' });
    expect((await form({ grant_type: 'authorization_code', code: good, client_id: appId, client_secret: clientSecret })).json().error).toBe('invalid_grant');
    const me = await app.inject({ method: 'GET', url: '/api/v1/oauth2/@me', headers: { authorization: `Bearer ${tokens.json().access_token}` } });
    expect(me.json()).toMatchObject({ application: { id: appId }, scopes: ['identify'], user: { id: guest.id, username: guest.username } });
    expect(me.json().user.email).toBeUndefined();

    // Now granted, it does not need asking again for the same scopes, but does for more.
    expect((await authorize(guest, { scopes: ['identify'] })).statusCode).toBe(200);
    expect((await authorize(guest, { scopes: ['identify', 'email'] })).json().code).toBe('CONSENT_REQUIRED');
    // And it shows up in Authorized Apps, where it can be revoked.
    expect((await call('GET', '/users/@me/oauth2/grants', guest)).json().grants.map((g: any) => g.application.id)).toContain(appId);

    // Built-in activities have no app to authorize.
    const board = (await call('POST', acts(), shy, { kind: 'whiteboard' })).json().activity;
    expect((await call('POST', `${acts()}/${board.id}/authorize`, shy, { scopes: ['identify'], consent: true })).statusCode).toBe(400);
    await call('POST', `${acts()}/${board.id}/leave`, shy);
    await call('POST', `${acts()}/${activity.id}/leave`, guest);
  });

  it('rate-limits authorization and relays small JSON broadcasts to the others only', async () => {
    if (!db || !redis) return;
    await redis.del(`activity:authorize:${teamDev.id}`);
    await inVoice(teamDev, commLink);
    const activity = (await call('POST', acts(), teamDev, { kind: 'app', appId })).json().activity;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call('POST', `${acts()}/${activity.id}/authorize`, teamDev, { scopes: ['identify'], consent: true })).statusCode);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);

    const send = (payload: unknown) => call('POST', `${acts()}/${activity.id}/events`, teamDev, { type: 'message', data: { payload } });
    expect((await send({ count: 1 })).statusCode).toBe(200);
    expect((await send('x'.repeat(5000))).json().code).toBe('ACTIVITY_MESSAGE_TOO_LARGE');
    expect((await call('POST', `${acts()}/${activity.id}/events`, teamDev, { type: 'message', data: {} })).statusCode).toBe(400);
    expect((await call('POST', `${acts()}/${activity.id}/events`, guest, { type: 'message', data: { payload: 1 } })).json().code).toBe('NOT_IN_ACTIVITY');
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) limited = (await send(i)).statusCode === 429;
    expect(limited).toBe(true);

    // Messages are not for built-in activities.
    await new Promise((r) => setTimeout(r, 1100));
    const board = (await call('POST', acts(), teamDev, { kind: 'whiteboard' })).json().activity;
    expect((await call('POST', `${acts()}/${board.id}/events`, teamDev, { type: 'message', data: { payload: 1 } })).statusCode).toBe(400);
    await call('POST', `${acts()}/${board.id}/leave`, teamDev);
  });

  it('removes the activity with its application', async () => {
    if (!db) return;
    expect((await call('DELETE', `/applications/${appId}/activity`, teamViewer)).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call('DELETE', `/applications/${appId}/activity`, teamDev)).statusCode).toBe(204);
    expect((await call('GET', `/applications/${appId}/activity`, dev)).json().activity).toBeNull();
    expect((await call('GET', '/console/activities', root)).json().activities.find((a: any) => a.application.id === appId)).toBeUndefined();
  });
});
