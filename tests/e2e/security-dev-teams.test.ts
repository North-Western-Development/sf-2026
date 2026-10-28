import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { appBots, devTeamMembers, eq } from '@subspace/database';
import { person, caller, seedPeople, cleanupPeople, captureBus, leaks } from '../support/security.js';

/**
 * Security: development teams and the application/bot routes they share. Every app and bot route
 * is tried with each role (owner, admin, developer, read-only, pending invitee, outsider), plus the
 * moves, removals and promotions a role must not be able to make.
 */
describe('Security: developer teams, apps and bots', () => {
  let app: FastifyInstance;
  let db: any;
  const owner = person('803756946623510001', 'sdt_owner');
  const admin = person('803756946623510002', 'sdt_admin');
  const admin2 = person('803756946623510003', 'sdt_admin2');
  const developer = person('803756946623510004', 'sdt_dev');
  const viewer = person('803756946623510005', 'sdt_viewer');
  const pending = person('803756946623510006', 'sdt_pending');
  const outsider = person('803756946623510007', 'sdt_outsider');
  const otherOwner = person('803756946623510008', 'sdt_other');
  const people = [owner, admin, admin2, developer, viewer, pending, outsider, otherOwner];
  const { call, asBot } = caller(() => app);
  const invite = (by: typeof owner, teamId: string, who: typeof owner, role: string) => call(by, 'POST', `/teams/${teamId}/members`, { username: who.username, discriminator: '0420', role });

  let teamId = '';
  let otherTeamId = '';
  let appId = '';
  let botToken = '';
  let botUserId = '';
  let clientSecret = '';
  let beaconId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await seedPeople(db, people);
    teamId = (await call(owner, 'POST', '/teams', { name: 'Red Team' })).json().team.id;
    otherTeamId = (await call(otherOwner, 'POST', '/teams', { name: 'Blue Team' })).json().team.id;
    for (const [who, role] of [
      [admin, 'admin'],
      [admin2, 'admin'],
      [developer, 'developer'],
      [viewer, 'read_only'],
      [pending, 'developer'],
    ] as const) {
      expect((await invite(owner, teamId, who, role)).statusCode).toBe(201);
      if (who !== pending) expect((await call(who, 'POST', `/teams/${teamId}/accept`)).statusCode).toBe(200);
    }
    // otherOwner's team has admin as a plain developer.
    await invite(otherOwner, otherTeamId, admin, 'developer');
    await call(admin, 'POST', `/teams/${otherTeamId}/accept`);

    const created = (await call(owner, 'POST', '/applications', { name: 'Shared App', redirectUris: ['https://example.com/cb'] })).json();
    appId = created.application.id;
    clientSecret = created.clientSecret;
    const bot = (await call(owner, 'POST', `/applications/${appId}/bot`)).json().bot;
    botToken = bot.token;
    botUserId = bot.userId;
    expect((await call(owner, 'POST', `/applications/${appId}/team`, { teamId })).statusCode).toBe(200);
    beaconId = (await call(outsider, 'POST', '/beacons', { name: 'Outsider Base' })).json().beacon.id;
  });

  afterAll(async () => {
    await cleanupPeople(db, people);
    await app.close();
  });

  it('every app and bot route answers each role as the role matrix says', async () => {
    if (!db) return;
    // [method, url, body, lowest role that may use it]
    const routes: Array<[string, string, unknown, 'read_only' | 'developer' | 'admin']> = [
      ['GET', `/applications/${appId}/bot`, undefined, 'read_only'],
      ['GET', `/applications/${appId}/activity`, undefined, 'read_only'],
      ['GET', `/applications/${appId}/commands`, undefined, 'read_only'],
      ['PATCH', `/applications/${appId}`, { description: 'probe' }, 'developer'],
      ['PATCH', `/applications/${appId}/bot`, { isPublic: false }, 'developer'],
      ['PUT', `/applications/${appId}/commands`, [{ name: 'probe', description: 'Probe command' }], 'developer'],
    ];
    const roles = { owner: owner, admin, developer, read_only: viewer } as const;
    const rank = { read_only: 1, developer: 2, admin: 3, owner: 4 } as const;
    const bad: string[] = [];
    for (const [method, url, body, needed] of routes) {
      for (const [role, who] of Object.entries(roles)) {
        const res = await call(who, method, url, body);
        const allowed = rank[role as keyof typeof rank] >= rank[needed];
        if (allowed ? res.statusCode >= 400 : res.statusCode !== 403 && res.statusCode !== 404) bad.push(`${role} ${method} ${url} -> ${res.statusCode}`);
      }
      // No access at all: the same answer as for an app that does not exist.
      for (const who of [pending, outsider, otherOwner]) {
        const res = await call(who, method, url, body);
        if (res.statusCode !== 404) bad.push(`${who.username} ${method} ${url} -> ${res.statusCode}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('secrets and tokens: only developers and above can mint them, and no GET ever returns them', async () => {
    if (!db) return;
    for (const who of [viewer, pending, outsider]) {
      expect((await call(who, 'POST', `/applications/${appId}/secret`)).statusCode, who.username).toBeGreaterThanOrEqual(403);
      expect((await call(who, 'POST', `/applications/${appId}/bot/reset-token`)).statusCode, who.username).toBeGreaterThanOrEqual(403);
    }
    const [row] = await db.select().from(appBots).where(eq(appBots.appId, appId)).limit(1);
    const secrets = [botToken, clientSecret, row.tokenHash, row.privateKeyEnc];
    const gets = [
      [viewer, `/applications/${appId}/bot`],
      [viewer, '/applications'],
      [viewer, '/teams'],
      [pending, '/teams'],
      [outsider, `/users/${botUserId}/profile`],
      [outsider, `/oauth2/applications/${appId}`],
      [owner, `/applications/${appId}/bot`],
      [owner, '/applications'],
    ] as const;
    for (const [who, url] of gets) {
      const res = await call(who, 'GET', url);
      expect(leaks(res.body, secrets), `${who.username} GET ${url}`).toEqual([]);
    }
    // The bot itself: its own view never echoes its token either.
    const me = await asBot(botToken, 'GET', '/bots/@me');
    expect(me.statusCode).toBe(200);
    expect(leaks(me.body, secrets)).toEqual([]);
    // read_only sees the public key (it is public) but not the token.
    expect((await call(viewer, 'GET', `/applications/${appId}/bot`)).json().bot).toMatchObject({ userId: botUserId, publicKey: row.publicKey });
    expect((await call(viewer, 'GET', `/applications/${appId}/bot`)).json().bot.token).toBeUndefined();
  });

  it('a pending invitation gives no access to the team or its applications', async () => {
    if (!db) return;
    expect((await call(pending, 'GET', '/applications')).json().applications).toEqual([]);
    expect((await call(pending, 'GET', '/teams')).json().teams).toEqual([]);
    expect((await call(pending, 'PATCH', `/teams/${teamId}`, { name: 'Taken Over' })).statusCode).toBe(404);
    expect((await invite(pending, teamId, outsider, 'read_only')).statusCode).toBe(404);
    expect((await call(pending, 'POST', `/applications/${appId}/team`, { teamId: null })).statusCode).toBe(403);
    // Accepting someone else's invitation is not a thing.
    expect((await call(outsider, 'POST', `/teams/${teamId}/accept`)).json().code).toBe('UNKNOWN_INVITATION');
    // A private bot cannot be added by a pending developer.
    expect((await call(pending, 'GET', `/oauth2/applications/${appId}`)).json().application.bot.canAdd).toBe(false);
    expect((await call(pending, 'GET', `/users/${botUserId}/profile`)).json().application.canAdd).toBe(false);
  });

  it('admins cannot make admins, change admins, remove admins, or delete the team', async () => {
    if (!db) return;
    // Inviting as admin, promoting to admin, demoting another admin, promoting themselves.
    expect((await invite(admin, teamId, outsider, 'admin')).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(admin, 'PATCH', `/teams/${teamId}/members/${developer.id}`, { role: 'admin' })).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(admin, 'PATCH', `/teams/${teamId}/members/${admin2.id}`, { role: 'read_only' })).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(admin, 'PATCH', `/teams/${teamId}/members/${admin.id}`, { role: 'admin' })).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(admin, 'DELETE', `/teams/${teamId}/members/${admin2.id}`)).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(admin, 'DELETE', `/teams/${teamId}`)).statusCode).toBe(403);
    // The owner is not a member row: nobody can "remove" or demote them.
    expect((await call(admin, 'DELETE', `/teams/${teamId}/members/${owner.id}`)).statusCode).toBe(404);
    expect((await call(admin, 'PATCH', `/teams/${teamId}/members/${owner.id}`, { role: 'read_only' })).statusCode).toBe(404);
    // A developer or read-only member manages nobody.
    expect((await call(developer, 'DELETE', `/teams/${teamId}/members/${viewer.id}`)).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(viewer, 'PATCH', `/teams/${teamId}/members/${viewer.id}`, { role: 'developer' })).json().code).toBe('TEAM_ROLE_TOO_LOW');
    // Body fuzzing: unknown roles and 'owner' are refused by the schema.
    for (const role of ['owner', 'ADMIN', '', 'superuser']) expect((await call(owner, 'PATCH', `/teams/${teamId}/members/${developer.id}`, { role })).statusCode, role).toBe(400);
    const [row] = await db.select().from(devTeamMembers).where(eq(devTeamMembers.transmitterId, developer.id)).limit(1);
    expect(row.role).toBe('developer');
    // An admin may still manage developers and read-only members.
    expect((await call(admin, 'PATCH', `/teams/${teamId}/members/${viewer.id}`, { role: 'read_only' })).statusCode).toBe(200);
  });

  it('applications move only into teams you administer, and only their owners move them out', async () => {
    if (!db) return;
    const mine = (await call(developer, 'POST', '/applications', { name: 'Dev Own' })).json().application.id;
    // A developer of the team cannot put their app into it (needs admin).
    expect((await call(developer, 'POST', `/applications/${mine}/team`, { teamId })).json().code).toBe('TEAM_ROLE_TOO_LOW');
    // Nobody moves someone else's application.
    expect((await call(outsider, 'POST', `/applications/${mine}/team`, { teamId: null })).statusCode).toBe(404);
    expect((await call(owner, 'POST', `/applications/${mine}/team`, { teamId })).statusCode).toBe(404);
    // Admins of the team cannot take the team's app out (to themselves) or into another team.
    expect((await call(admin, 'POST', `/applications/${appId}/team`, { teamId: null })).json().code).toBe('TEAM_ROLE_TOO_LOW');
    expect((await call(admin, 'POST', `/applications/${appId}/team`, { teamId: otherTeamId })).json().code).toBe('TEAM_ROLE_TOO_LOW');
    // The team's owner cannot push it into a team they only develop for.
    expect((await call(otherOwner, 'POST', `/applications/${appId}/team`, { teamId: null })).statusCode).toBe(403);
    // Unknown team ids are refused, not created.
    expect((await call(developer, 'POST', `/applications/${mine}/team`, { teamId: '803756946623519999' })).statusCode).toBe(403);
    expect((await call(developer, 'POST', `/applications/${mine}/team`, { teamId: '0' })).statusCode).toBe(400);
    // Still where they were.
    expect((await call(owner, 'GET', '/applications')).json().applications.find((a: any) => a.id === appId)).toMatchObject({ teamId, role: 'owner' });
    await call(developer, 'DELETE', `/applications/${mine}`);
  });

  it('a removed member loses access at once, including to bot-adding and secrets', async () => {
    if (!db) return;
    const temp = person('803756946623510009', 'sdt_temp');
    await seedPeople(db, [temp]);
    try {
      await invite(owner, teamId, temp, 'developer');
      await call(temp, 'POST', `/teams/${teamId}/accept`);
      expect((await call(temp, 'GET', `/applications/${appId}/bot`)).statusCode).toBe(200);
      expect((await call(owner, 'DELETE', `/teams/${teamId}/members/${temp.id}`)).statusCode).toBe(204);
      expect((await call(temp, 'GET', `/applications/${appId}/bot`)).statusCode).toBe(404);
      expect((await call(temp, 'POST', `/applications/${appId}/secret`)).statusCode).toBe(404);
      const base = (await call(temp, 'POST', '/beacons', { name: 'Temp Base' })).json().beacon.id;
      expect((await call(temp, 'POST', `/beacons/${base}/bots`, { appId, permissions: '0' })).json().code).toBe('PRIVATE_BOT');
    } finally {
      await cleanupPeople(db, [temp]);
    }
  });

  it('private bots are added only by their developers, and never with more than the adder holds', async () => {
    if (!db) return;
    // The outsider owns a beacon but does not develop the bot.
    expect((await call(outsider, 'POST', `/beacons/${beaconId}/bots`, { appId, permissions: '0' })).json().code).toBe('PRIVATE_BOT');
    expect((await call(outsider, 'GET', `/users/${botUserId}/profile`)).json().application.canAdd).toBe(false);
    expect((await call(outsider, 'GET', `/oauth2/applications/${appId}`)).json().application.bot.canAdd).toBe(false);
    // A read-only member does not count as a developer for adding it.
    const viewerBase = (await call(viewer, 'POST', '/beacons', { name: 'Viewer Base' })).json().beacon.id;
    expect((await call(viewer, 'POST', `/beacons/${viewerBase}/bots`, { appId, permissions: '0' })).json().code).toBe('PRIVATE_BOT');
    expect((await call(viewer, 'GET', `/oauth2/applications/${appId}`)).json().application.bot.canAdd).toBe(false);
    // The developer may add it to a beacon they manage, but not into someone else's beacon.
    expect((await call(developer, 'POST', `/beacons/${beaconId}/bots`, { appId, permissions: '0' })).statusCode).toBe(404);
    // Silly permission values are refused by the schema rather than overflowing.
    expect((await call(viewer, 'POST', `/beacons/${viewerBase}/bots`, { appId, permissions: '-1' })).statusCode).toBe(400);
    expect((await call(viewer, 'POST', `/beacons/${viewerBase}/bots`, { appId, permissions: '1e9' })).statusCode).toBe(400);
  });

  it('botVerified is only ever true for bots: people and webhooks cannot carry it', async () => {
    if (!db) return;
    const root = person('803756946623510010', 'sdt_root', 3);
    await seedPeople(db, [root]);
    try {
      // Staff verify a person (for the developer policy): their profile still has no bot check.
      expect((await call(root, 'PATCH', `/console/transmitters/${developer.id}/verified`, { verified: true })).statusCode).toBe(200);
      const profile = (await call(outsider, 'GET', `/users/${developer.id}/profile`)).json();
      expect(profile.user.botVerified).toBeUndefined();
      expect(JSON.stringify(profile)).not.toContain('handVerifiedAt');
      // Webhooks cannot be verified at all.
      const relay = (await call(outsider, 'GET', `/beacons/${beaconId}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
      const hook = (await call(outsider, 'POST', `/relays/${relay}/webhooks`, { name: 'Hook' })).json().webhook;
      const author = (await call(outsider, 'POST', `/webhooks/${hook.id}/${hook.token}`, { content: 'hi' })).json().transmission.author;
      expect((await call(root, 'PATCH', `/console/transmitters/${author.id}/verified`, { verified: true })).json().code).toBe('NOT_VERIFIABLE');
      // Only staff verify; nobody verifies themselves or their bot.
      expect((await call(owner, 'PATCH', `/console/transmitters/${botUserId}/verified`, { verified: true })).statusCode).toBe(403);
      expect((await call(owner, 'PATCH', `/console/transmitters/${owner.id}/verified`, { verified: true })).statusCode).toBe(403);
      // Profile-editing routes cannot smuggle it in.
      await call(developer, 'PATCH', '/users/@me/profile', { botVerified: true, botKind: 'bot', handVerifiedAt: new Date().toISOString() });
      expect((await call(outsider, 'GET', `/users/${developer.id}/profile`)).json().user).not.toHaveProperty('botKind', 'bot');
      await call(root, 'PATCH', `/console/transmitters/${developer.id}/verified`, { verified: false });
    } finally {
      await cleanupPeople(db, [root]);
    }
  });

  // Fixed (was a security bug): a verified bot keeps its check mark when its application is renamed. The check
  // exists "against impersonation" (console.routes.ts PATCH /transmitters/:id/verified), but any
  // team developer can rename the app (oauth.routes.ts PATCH /applications/:id -> renameAppUser)
  // and its avatar afterwards, so a verified "Weather Bot" can become a verified "Subspace Staff".
  // Suggested fix: clear transmitters.handVerifiedAt for the bot user when the app's name or icon
  // changes (or refuse renames of verified apps until staff re-review), as Discord does.
  it('renaming a verified bot takes its verification away (or is refused)', async () => {
    if (!db) throw new Error('needs the database');
    const root = person('803756946623510011', 'sdt_root2', 3);
    await seedPeople(db, [root]);
    try {
      await call(root, 'PATCH', `/console/transmitters/${botUserId}/verified`, { verified: true });
      expect((await call(outsider, 'GET', `/users/${botUserId}/profile`)).json().user.botVerified).toBe(true);
      const renamed = await call(developer, 'PATCH', `/applications/${appId}`, { name: 'Subspace Staff' });
      const profile = (await call(outsider, 'GET', `/users/${botUserId}/profile`)).json().user;
      expect(renamed.statusCode !== 200 || !profile.botVerified).toBe(true);
    } finally {
      await call(root, 'PATCH', `/console/transmitters/${botUserId}/verified`, { verified: false });
      await call(owner, 'PATCH', `/applications/${appId}`, { name: 'Shared App' });
      await cleanupPeople(db, [root]);
    }
  });

  it('resetting a bot token kills the old token everywhere at once, and closes its gateway sockets', async () => {
    if (!db) return;
    const before = botToken;
    expect((await asBot(before, 'GET', '/bots/@me')).statusCode).toBe(200);
    let fresh = '';
    const events = await captureBus(async () => {
      fresh = (await call(developer, 'POST', `/applications/${appId}/bot/reset-token`)).json().bot.token;
    });
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(before);
    expect((await asBot(before, 'GET', '/bots/@me')).statusCode).toBe(401);
    expect((await asBot(fresh, 'GET', '/bots/@me')).statusCode).toBe(200);
    // The gateway is told to close every socket the bot has open.
    expect(events).toContainEqual(expect.objectContaining({ type: 'SESSION_REVOKE', transmitter_id: botUserId, all: true }));
    botToken = fresh;
  });

  it('bot tokens only reach the routes made for bots', async () => {
    if (!db) return;
    const refused = [
      ['GET', '/users/@me/oauth2/grants'],
      ['GET', '/users/@me/mentions'],
      ['GET', '/teams'],
      ['POST', '/teams', { name: 'Bot Team' }],
      ['POST', '/applications', { name: 'Bot App' }],
      ['GET', '/applications'],
      ['POST', `/applications/${appId}/secret`],
      ['POST', `/applications/${appId}/bot/reset-token`],
      ['POST', '/oauth2/authorize', { clientId: appId, redirectUri: 'https://example.com/cb', scope: 'identify' }],
      ['PATCH', '/users/@me/status', { customStatus: { text: 'beep' } }],
      ['PUT', `/users/${owner.id}/note`, { note: 'x' }],
      ['GET', '/users/@me/bookmarks'],
      ['POST', `/relays/${'803756946623519998'}/followers`, { targetRelayId: '803756946623519997' }],
      ['POST', '/embed-proxy/sign', { urls: ['https://example.com/a.png'] }],
      ['GET', '/console/developer-policy'],
      ['GET', '/activities/apps'],
    ] as const;
    for (const [method, url, body] of refused) {
      const res = await asBot(botToken, method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().code, `${method} ${url}`).toBe('BOT_FORBIDDEN');
    }
  });

  it('bot route allow-list: every route a bot token may reach is on the reviewed list', async () => {
    if (!db) return;
    const { botMayUse } = await import('../../apps/api-service/src/lib/bot-auth.js');
    const reachable = ((app as any).routeTable as Array<{ method: string; url: string }>).filter((r) => r.method !== 'HEAD' && botMayUse(r.method, r.url)).map((r) => `${r.method} ${r.url}`);
    // Anything here that is not meant for bots (account, settings, DMs) is a leak.
    const personOnly = reachable.filter((r) => /\/users\/@me|\/auth\/|\/console\/|\/oauth2\/|\/teams|\/vault|\/search|\/invites|\/settings|\/applications\/:id(\/|$)/.test(r));
    expect(personOnly).toEqual([]);
  });

  // SECURITY BUG (low): the bot allow-list pattern /^GET \/api\/v1\/beacons\/[^/]+(...)?$/
  // (apps/api-service/src/lib/bot-auth.ts, BOT_ROUTES second entry) is meant for GET
  // /beacons/:id, but [^/]+ also matches static routes registered under /beacons, so bot tokens
  // reach GET /api/v1/beacons/discovery (a person-facing directory: bots can crawl every
  // discoverable beacon) and GET /api/v1/beacons/me (fine for a bot, but matched by accident;
  // review it). Fix: anchor it to the parameter, e.g. /^GET \/api\/v1\/beacons\/:id(\/(relays|members|clearances|bans))?$/.
  it('the GET /beacons/:id pattern matches only beacon-scoped routes (not /beacons/discovery)', async () => {
    const { botMayUse } = await import('../../apps/api-service/src/lib/bot-auth.js');
    const reachable = ((app as any).routeTable as Array<{ method: string; url: string }>).filter((r) => r.method !== 'HEAD' && botMayUse(r.method, r.url)).map((r) => `${r.method} ${r.url}`);
    const beaconReads = reachable.filter((r) => /^GET \/api\/v1\/beacons\/[^/]+$/.test(r));
    expect(beaconReads.filter((r) => !/\/beacons\/:[A-Za-z]+$/.test(r))).toEqual([]);
  });

  it('deleting a team: only its owner, and its apps stay with the owner, not with an admin', async () => {
    if (!db) return;
    const t = (await call(owner, 'POST', '/teams', { name: 'Short Lived' })).json().team.id;
    await invite(owner, t, admin, 'admin');
    await call(admin, 'POST', `/teams/${t}/accept`);
    const a = (await call(owner, 'POST', '/applications', { name: 'Short App' })).json().application.id;
    await call(owner, 'POST', `/applications/${a}/team`, { teamId: t });
    for (const who of [admin, developer, outsider]) expect((await call(who, 'DELETE', `/teams/${t}`)).statusCode, who.username).toBeGreaterThanOrEqual(403);
    expect((await call(owner, 'DELETE', `/teams/${t}`)).statusCode).toBe(204);
    expect((await call(admin, 'GET', `/applications/${a}/bot`)).statusCode).toBe(404);
    expect((await call(owner, 'GET', '/applications')).json().applications.find((x: any) => x.id === a)).toMatchObject({ teamId: null, role: 'owner' });
    await call(owner, 'DELETE', `/applications/${a}`);
  });

  it('application edits: redirect URIs and icons are validated, and no other app’s icon can be borrowed', async () => {
    if (!db) return;
    for (const uri of ['javascript:alert(1)', 'http://example.com/cb', 'https://example.com/cb#frag', 'data:text/html,x', 'http://localhost.evil.com/cb', '//example.com/cb']) {
      expect((await call(developer, 'PATCH', `/applications/${appId}`, { redirectUris: [uri] })).json().code, uri).toBe('INVALID_REDIRECT_URI');
    }
    for (const iconUrl of ['https://evil.example/x.png', '/subspace-media/avatars/someone-else.png', 'javascript:alert(1)', '/subspace-media/../api/v1/users/@me']) {
      expect((await call(developer, 'PATCH', `/applications/${appId}`, { iconUrl })).json().code, iconUrl).toBe('INVALID_ICON');
    }
    // Extra keys (ownerId, teamId, clientSecretHash) never change the app.
    await call(developer, 'PATCH', `/applications/${appId}`, { name: 'Shared App', ownerId: developer.id, teamId: null, clientSecretHash: 'x' } as any);
    expect((await call(owner, 'GET', '/applications')).json().applications.find((a: any) => a.id === appId)).toMatchObject({ teamId, role: 'owner' });
    expect((await call(developer, 'GET', '/applications')).json().applications.find((a: any) => a.id === appId)).toMatchObject({ role: 'developer' });
  });

  // SECURITY BUG (low, error disclosure / robustness): a PATCH whose keys are all unknown (the
  // schema's additionalProperties:false strips them, Fastify's default removeAdditional) or an
  // empty {} reaches drizzle's update().set({}) and answers 500 "No values to set".
  // oauth.routes.ts PATCH /applications/:id (the .set({...}) call). Fix: if nothing is left to
  // set, answer 400 (or 200 with the unchanged app) before calling update().
  it('PATCH /applications/:id with nothing to change answers 4xx, not 500', async () => {
    if (!db) throw new Error('needs the database');
    for (const body of [{}, { ownerId: developer.id }]) {
      const res = await call(developer, 'PATCH', `/applications/${appId}`, body);
      expect(res.statusCode, JSON.stringify(body)).toBeLessThan(500);
    }
  });

  it('OAuth deny and authorize redirect only to registered URIs (no open redirect)', async () => {
    if (!db) return;
    const deny = (redirectUri: string, clientId = appId) => call(outsider, 'POST', '/oauth2/deny', { clientId, redirectUri, state: 'abc' });
    const ok = await deny('https://example.com/cb');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().location).toBe('https://example.com/cb?error=access_denied&state=abc');
    for (const uri of ['https://evil.example/cb', 'https://example.com/cb/../x', 'https://example.com/cb?x=1', 'https://EXAMPLE.com/cb', 'https://example.com/cb ']) {
      expect((await deny(uri)).json().code, uri).toBe('INVALID_REDIRECT_URI');
      expect((await call(outsider, 'POST', '/oauth2/authorize', { clientId: appId, redirectUri: uri, scope: 'identify' })).json().code, uri).toBe('INVALID_REDIRECT_URI');
    }
    expect((await deny('https://example.com/cb', 'abc')).json().code).toBe('UNKNOWN_APPLICATION');
    expect((await deny('https://example.com/cb', '803756946623519996')).json().code).toBe('INVALID_REDIRECT_URI');
    // Deny needs a signed-in person, like the consent page.
    expect((await app.inject({ method: 'POST', url: '/api/v1/oauth2/deny', payload: { clientId: appId, redirectUri: 'https://example.com/cb' } })).statusCode).toBe(401);
  });

  it('OAuth codes: a normal code needs its redirect_uri, is single use, and is bound to its client', async () => {
    if (!db) return;
    const form = (fields: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/api/v1/oauth2/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString() });
    const code = async () => new URL((await call(outsider, 'POST', '/oauth2/authorize', { clientId: appId, redirectUri: 'https://example.com/cb', scope: 'identify' })).json().location).searchParams.get('code')!;
    // A normal code exchanged without redirect_uri (as if it were an Activity's code) is refused.
    expect((await form({ grant_type: 'authorization_code', code: await code(), client_id: appId, client_secret: clientSecret })).json().error).toBe('invalid_grant');
    expect((await form({ grant_type: 'authorization_code', code: await code(), client_id: appId, client_secret: clientSecret, redirect_uri: '' })).json().error).toBe('invalid_grant');
    const good = await code();
    expect((await form({ grant_type: 'authorization_code', code: good, client_id: appId, client_secret: clientSecret, redirect_uri: 'https://example.com/cb' })).statusCode).toBe(200);
    expect((await form({ grant_type: 'authorization_code', code: good, client_id: appId, client_secret: clientSecret, redirect_uri: 'https://example.com/cb' })).json().error).toBe('invalid_grant');
    // Junk and type confusion never crash the endpoint.
    for (const payload of ['grant_type=authorization_code&code[]=x', 'client_id=1&client_id=2&client_secret=x', 'grant_type=refresh_token&refresh_token=', `client_id=${appId}&client_secret=${'x'.repeat(5000)}`]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/oauth2/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload });
      expect(res.statusCode, payload.slice(0, 60)).toBeLessThan(500);
    }
    // Basic auth with a colon in the "secret" part, or no colon at all.
    for (const basic of [Buffer.from(`${appId}`).toString('base64'), Buffer.from(`${appId}:wrong:${clientSecret}`).toString('base64'), 'not base64!!']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/oauth2/token', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'grant_type=refresh_token&refresh_token=x' });
      expect(res.statusCode).toBe(401);
    }
  });

  it('team routes with malformed ids and bodies are refused cleanly (no 500s)', async () => {
    if (!db) return;
    const probes: Array<[string, string, unknown?]> = [
      ['PATCH', '/teams/abc', { name: 'xx' }],
      ['PATCH', '/teams/99999999999999999999', { name: 'xx' }],
      ['DELETE', '/teams/0'],
      ['POST', `/teams/${teamId}/members`, { username: 'x', discriminator: '42', role: 'developer' }],
      ['POST', `/teams/${teamId}/members`, { username: { $ne: '' }, discriminator: '0420', role: 'developer' }],
      ['POST', `/teams/${teamId}/members`, { username: 'x'.repeat(65), discriminator: '0420', role: 'developer' }],
      ['PATCH', `/teams/${teamId}/members/abc`, { role: 'developer' }],
      ['DELETE', `/teams/${teamId}/members/-1`],
      ['POST', '/teams', { name: 'x' }],
      ['POST', '/teams', { name: 'ok name', ownerId: outsider.id }],
      ['POST', '/applications/abc/team', { teamId: null }],
      ['GET', '/applications/abc/bot'],
      ['GET', '/applications/abc/commands'],
      ['GET', '/applications/99999999999999999999/commands'],
      ['PUT', '/applications/abc/beacons/abc/commands', []],
      ['GET', '/oauth2/applications/abc'],
      ['POST', '/beacons/abc/bots', { appId }],
      ['DELETE', '/beacons/abc/bots/abc'],
    ];
    const crashes: string[] = [];
    for (const [method, url, body] of probes) {
      const res = await call(owner, method, url, body);
      if (res.statusCode >= 500) crashes.push(`${method} ${url} -> ${res.statusCode}`);
    }
    expect(crashes).toEqual([]);
    // A team created with a smuggled ownerId belongs to its creator.
    const teams = (await call(owner, 'GET', '/teams')).json().teams;
    expect(teams.every((t: any) => t.owner.id === owner.id)).toBe(true);
  });
});
