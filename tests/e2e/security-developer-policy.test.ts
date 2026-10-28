import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { buildApp } from '../../apps/api-service/src/index.js';
import { createGatewayServer, type GatewayResolver } from '../../apps/gateway-service/src/index.js';
import { DEFAULT_DEVELOPER_POLICY, GATEWAY_OPCODES } from '@subspace/constants';
import { instanceSettings, resolveBotIntents, DEVELOPER_POLICY_KEY, eq } from '@subspace/database';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { person, caller, seedPeople, cleanupPeople, captureBus } from '../support/security.js';

/**
 * Security: the developer policy, hand verification, verified games, and how the privileged
 * intents it controls are enforced (the API, the REST message history, and the gateway).
 */
describe('Security: developer policy, verification and verified games', () => {
  let app: FastifyInstance;
  let db: any;
  const root = person('803756946623520001', 'sdp_root', 3);
  const mod = person('803756946623520002', 'sdp_mod', 2);
  const dev = person('803756946623520003', 'sdp_dev');
  const member = person('803756946623520004', 'sdp_member');
  const people = [root, mod, dev, member];
  const { call, asBot } = caller(() => app);
  const setPolicy = (patch: Record<string, unknown>) => call(root, 'PUT', '/console/developer-policy', { ...DEFAULT_DEVELOPER_POLICY, ...patch });

  let appId = '';
  let botUserId = '';
  let botToken = '';
  let beaconId = '';
  let general = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY));
    await seedPeople(db, people);
    appId = (await call(dev, 'POST', '/applications', { name: 'Policy Bot' })).json().application.id;
    const bot = (await call(dev, 'POST', `/applications/${appId}/bot`)).json().bot;
    botUserId = bot.userId;
    botToken = bot.token;
    beaconId = (await call(dev, 'POST', '/beacons', { name: 'Policy Lab', isDiscoverable: true })).json().beacon.id;
    general = (await call(dev, 'GET', `/beacons/${beaconId}/relays`)).json().relays.find((r: any) => r.type === 'text').id;
    await call(member, 'POST', `/beacons/${beaconId}/join`);
    expect((await call(dev, 'POST', `/beacons/${beaconId}/bots`, { appId, permissions: '0' })).statusCode).toBe(201);
  });

  afterAll(async () => {
    if (db) await db.delete(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY));
    await cleanupPeople(db, people);
    await app.close();
  });

  it('only staff with Manage Developers read or change the policy, verify accounts, or verify games', async () => {
    if (!db) return;
    const routes: Array<[string, string, unknown?]> = [
      ['GET', '/console/developer-policy'],
      ['PUT', '/console/developer-policy', DEFAULT_DEVELOPER_POLICY],
      ['PATCH', `/console/transmitters/${dev.id}/verified`, { verified: true }],
      ['GET', '/console/verified-games'],
      ['PUT', '/console/verified-games', { game: 'Valheim', applicationId: appId }],
      ['DELETE', '/console/verified-games?game=Valheim'],
    ];
    for (const who of [dev, mod]) {
      for (const [method, url, body] of routes) {
        const res = await call(who, method, url, body);
        expect(res.statusCode, `${who.username} ${method} ${url}`).toBe(403);
      }
    }
    // A forged staffRank in the token is not trusted: rank comes from the database.
    const forged = { authorization: `Bearer ${signAccessToken({ transmitterId: dev.id, username: dev.username, staffRank: 9 }, getJwtSecret())}` };
    expect((await app.inject({ method: 'GET', url: '/api/v1/console/developer-policy', headers: forged })).statusCode).toBe(403);
    // The public game list is readable by anyone signed in, and names no owners.
    const pub = await call(dev, 'GET', '/oauth2/verified-games');
    expect(pub.statusCode).toBe(200);
    expect(JSON.stringify(pub.json())).not.toMatch(/ownerId|owner"/);
  });

  it('the policy body is strictly typed: wrong types, empty or unknown methods, missing intents', async () => {
    if (!db) return;
    const bad: unknown[] = [
      { ...DEFAULT_DEVELOPER_POLICY, verifiedBy: [] },
      { ...DEFAULT_DEVELOPER_POLICY, verifiedBy: ['email', 'email'] },
      { ...DEFAULT_DEVELOPER_POLICY, verifiedBy: ['carrier-pigeon'] },
      { ...DEFAULT_DEVELOPER_POLICY, createApps: 'nobody' },
      { ...DEFAULT_DEVELOPER_POLICY, createApps: true },
      { ...DEFAULT_DEVELOPER_POLICY, createAppsRequires: ['staff'] },
      { ...DEFAULT_DEVELOPER_POLICY, intents: { messageContent: 'verified' } },
      { ...DEFAULT_DEVELOPER_POLICY, intents: { messageContent: 'verified', activity: 'nobody' } },
      { ...DEFAULT_DEVELOPER_POLICY, intents: null },
      { verifiedBy: ['email'] },
      [],
      'verified',
    ];
    for (const body of bad) expect([400, 415], JSON.stringify(body)).toContain((await call(root, 'PUT', '/console/developer-policy', body)).statusCode);
    // Prototype pollution through the JSON body is refused by the parser.
    const proto = await app.inject({
      method: 'PUT',
      url: '/api/v1/console/developer-policy',
      headers: { ...caller(() => app).auth(root), 'content-type': 'application/json' },
      payload: `{"verifiedBy":["email"],"createApps":"everyone","createAppsRequires":[],"intents":{"messageContent":"everyone","activity":"everyone"},"__proto__":{"polluted":true}}`,
    });
    expect(proto.statusCode).toBe(400);
    expect(({} as any).polluted).toBeUndefined();
    // Extra keys never reach the stored policy.
    const res = await call(root, 'PUT', '/console/developer-policy', { ...DEFAULT_DEVELOPER_POLICY, intents: { ...DEFAULT_DEVELOPER_POLICY.intents, admin: 'everyone' }, superuser: true });
    if (res.statusCode === 200) expect(Object.keys(res.json().policy).sort()).toEqual(['createApps', 'createAppsRequires', 'intents', 'verifiedBy']);
    const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY)).limit(1);
    if (row) expect(JSON.stringify(row)).not.toMatch(/superuser|admin/);
    expect((await call(root, 'GET', '/console/developer-policy')).json().policy).toEqual(DEFAULT_DEVELOPER_POLICY);
    await db.delete(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY));
  });

  it('a stored policy that is corrupt falls back to safe defaults, never to "nobody is verified"', async () => {
    if (!db) return;
    const { loadDeveloperPolicy } = await import('@subspace/database');
    for (const value of [{ verifiedBy: [] }, { verifiedBy: 'x', intents: 'y' }, null, 42, { intents: { messageContent: 'VERIFIED' } }]) {
      await db.delete(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY));
      await db.insert(instanceSettings).values({ key: DEVELOPER_POLICY_KEY, value } as any).catch(() => {});
      const policy = await loadDeveloperPolicy(db);
      expect(policy.verifiedBy.length, JSON.stringify(value)).toBeGreaterThan(0);
      expect(['everyone', 'verified']).toContain(policy.intents.messageContent);
    }
    await db.delete(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY));
  });

  it('tightening the policy revokes intents from connected bots at once (session refresh)', async () => {
    if (!db) return;
    await setPolicy({});
    await call(dev, 'PATCH', `/applications/${appId}/bot`, { messageContent: true, activityIntent: true });
    expect(await resolveBotIntents(db, botUserId)).toEqual({ messageContent: true, activity: true });
    const events = await captureBus(() => setPolicy({ verifiedBy: ['staff'], intents: { messageContent: 'verified', activity: 'verified' } }));
    expect(await resolveBotIntents(db, botUserId)).toEqual({ messageContent: false, activity: false });
    // The gateway is told to reload this bot's intents.
    expect(JSON.stringify(events)).toContain(botUserId);
    // Enabling is refused while unverified, and a verified team developer cannot lend their verification:
    // what counts at runtime is the app owner's.
    expect((await call(dev, 'PATCH', `/applications/${appId}/bot`, { messageContent: true })).json().code).toBe('INTENT_RESTRICTED');
    // Staff unverifying the owner revokes them again.
    await call(root, 'PATCH', `/console/transmitters/${dev.id}/verified`, { verified: true });
    expect(await resolveBotIntents(db, botUserId)).toEqual({ messageContent: true, activity: true });
    await call(root, 'PATCH', `/console/transmitters/${dev.id}/verified`, { verified: false });
    expect(await resolveBotIntents(db, botUserId)).toEqual({ messageContent: false, activity: false });
    await db.delete(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY));
  });

  it('verified games: unknown games, unknown apps, and one app per game', async () => {
    if (!db) return;
    for (const game of ['', 'valheim', 'Valheim ', '<script>alert(1)</script>', 'x'.repeat(129), '__proto__', 'constructor']) {
      const res = await call(root, 'PUT', '/console/verified-games', { game, applicationId: appId });
      expect(res.statusCode, game).toBe(400);
    }
    expect((await call(root, 'PUT', '/console/verified-games', { game: 'Valheim', applicationId: 'abc' })).statusCode).toBe(400);
    expect((await call(root, 'PUT', '/console/verified-games', { game: 'Valheim', applicationId: '803756946623529999' })).statusCode).toBe(404);
    const other = (await call(member, 'POST', '/applications', { name: 'Impostor' })).json().application.id;
    expect((await call(root, 'PUT', '/console/verified-games', { game: 'Valheim', applicationId: appId })).statusCode).toBe(200);
    expect((await call(root, 'PUT', '/console/verified-games', { game: 'Valheim', applicationId: other })).statusCode).toBe(200);
    const games = (await call(dev, 'GET', '/oauth2/verified-games')).json().games;
    expect(games.Valheim.applicationId).toBe(other);
    expect(Object.values(games).filter((g: any) => g.applicationId === appId)).toEqual([]);
    // Developers cannot set detectedGame themselves.
    await call(dev, 'PATCH', `/applications/${appId}`, { name: 'Policy Bot', detectedGame: 'Terraria' } as any);
    expect((await call(dev, 'GET', '/oauth2/verified-games')).json().games.Terraria?.applicationId).not.toBe(appId);
    // Unknown deletes are a clean 404, not a wildcard.
    expect((await call(root, 'DELETE', '/console/verified-games?game=')).statusCode).toBe(404);
    expect((await call(root, 'DELETE', '/console/verified-games?game=%25')).statusCode).toBe(404);
    expect((await call(root, 'DELETE', '/console/verified-games?game=Valheim')).statusCode).toBe(204);
  });

  it('verification flags: webhooks refused, unknown and deleted accounts 404, malformed ids 400', async () => {
    if (!db) return;
    expect((await call(root, 'PATCH', '/console/transmitters/803756946623529998/verified', { verified: true })).statusCode).toBe(404);
    expect((await call(root, 'PATCH', '/console/transmitters/abc/verified', { verified: true })).statusCode).toBe(400);
    expect((await call(root, 'PATCH', `/console/transmitters/${dev.id}/verified`, { verified: 'yes' })).statusCode).toBe(400);
    expect((await call(root, 'PATCH', `/console/transmitters/${dev.id}/verified`, {})).statusCode).toBe(400);
    const hook = (await call(dev, 'POST', `/relays/${general}/webhooks`, { name: 'Hook' })).json().webhook;
    const author = (await call(dev, 'POST', `/webhooks/${hook.id}/${hook.token}`, { content: 'x' })).json().transmission.author.id;
    expect((await call(root, 'PATCH', `/console/transmitters/${author}/verified`, { verified: true })).json().code).toBe('NOT_VERIFIABLE');
  });

  // SECURITY BUG (medium): the Message Content intent is only enforced on the gateway (forBot in
  // apps/gateway-service/src/index.ts). The REST history a bot token may call
  // (BOT_ROUTES: GET /api/v1/channels/:channelType/:channelId/transmissions and .../pins in
  // apps/api-service/src/lib/bot-auth.ts) returns every message's full content, embeds and
  // attachments, so a bot without the intent (or one whose intent the policy just revoked) reads
  // everything by polling. Fix: apply the same redaction as forBot in the transmissions/pins GET
  // handlers when the caller is a bot without messageContent (resolveBotIntents), exempting
  // its own messages, messages that mention it, and DMs.
  it('a bot without the Message Content intent cannot read message text over REST either', async () => {
    if (!db) throw new Error('needs the database');
    await call(dev, 'PATCH', `/applications/${appId}/bot`, { messageContent: false });
    expect(await resolveBotIntents(db, botUserId)).toMatchObject({ messageContent: false });
    expect((await call(member, 'POST', `/channels/relay/${general}/transmissions`, { content: 'the launch codes are 0000' })).statusCode).toBe(201);
    const res = await asBot(botToken, 'GET', `/channels/relay/${general}/transmissions`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('the launch codes are 0000');
  });
});

/** The gateway's half: what a bot session receives with and without its intents. */
describe('Security: gateway intents for bots (forBot, activity, op 3)', () => {
  const PORT = 3981;
  const intents = { messageContent: false, activity: false };
  const resolver: GatewayResolver = {
    getPresencePeers: async (id) => (id === 'person' ? ['bot', 'friend'] : id === 'bot' ? ['person'] : ['person']),
    getBeaconIds: async () => ['b1'],
    getFriendIds: async (id) => (id === 'person' ? ['friend'] : id === 'friend' ? ['person'] : []),
    getActivityVisibility: async () => 'friends',
    authorizeVoice: async () => null,
    canPrioritySpeak: async () => false,
    authorizeCall: async () => null,
    finishCall: async () => {},
    resolveBot: async (token) => (token === 'tok' ? { transmitterId: 'bot', username: 'bot', ...intents } : null),
    getBotIntents: async () => ({ ...intents }),
  };
  let server: ReturnType<typeof createGatewayServer>;
  let open: WebSocket[] = [];
  beforeAll(() => {
    server = createGatewayServer(PORT, { redis: false, resolver });
  });
  afterAll(async () => {
    await server.close();
  });
  afterEach(async () => {
    for (const ws of open) ws.close();
    open = [];
    intents.messageContent = false;
    intents.activity = false;
    await new Promise((r) => setTimeout(r, 100));
  });

  async function connect(id: string, token?: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    open.push(ws);
    const got: Array<{ t: string; d: any }> = [];
    let closed: number | null = null;
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t) got.push({ t: m.t, d: m.d });
    });
    ws.on('close', (code) => (closed = code));
    await new Promise<void>((r) => ws.on('open', () => r()));
    ws.send(JSON.stringify({ op: GATEWAY_OPCODES.IDENTIFY, d: { token: token ?? signAccessToken({ transmitterId: id, username: id, staffRank: 0 }, getJwtSecret()) } }));
    await expect.poll(() => got.some((g) => g.t === 'READY')).toBe(true);
    return { ws, got, closed: () => closed, last: (t: string) => got.filter((g) => g.t === t).at(-1)?.d };
  }
  const relayMsg = (extra: Record<string, unknown> = {}) => ({
    type: 'TRANSMISSION_CREATE',
    audience: ['bot', 'person'],
    channelType: 'relay',
    channelId: 'r1',
    transmission: {
      id: 't1',
      content: 'secret text',
      author: { id: 'person' },
      mentions: [],
      mentionEveryone: false,
      embeds: [{ type: 'rich', title: 'secret embed' }],
      attachments: [{ url: '/secret.png' }],
      stickers: [{ id: 's' }],
      poll: { question: 'secret poll' },
      replyTo: { id: 't0', content: 'secret reply', author: { id: 'person' } },
      forwarded: { content: 'secret forward', attachments: [{ url: '/f.png' }], stickers: [] },
      ...extra,
    },
  });

  it('without Message Content a bot sees no text anywhere in a transmission, including replies and forwards', async () => {
    const bot = await connect('bot', 'Bot tok');
    const human = await connect('person');
    server.deliverDispatch(relayMsg() as any);
    await expect.poll(() => bot.last('TRANSMISSION_CREATE')).toBeTruthy();
    const seen = JSON.stringify(bot.last('TRANSMISSION_CREATE'));
    expect(seen).not.toMatch(/secret/);
    // People get it all.
    await expect.poll(() => JSON.stringify(human.last('TRANSMISSION_CREATE') ?? '')).toContain('secret text');
    // Edits and late link previews are text too.
    server.deliverDispatch({ ...relayMsg(), type: 'TRANSMISSION_UPDATE' } as any);
    server.deliverDispatch({ type: 'TRANSMISSION_EMBEDS_UPDATE', audience: ['bot'], channelType: 'relay', channelId: 'r1', transmissionId: 't1', embeds: [{ title: 'secret preview' }] } as any);
    await expect.poll(() => bot.last('TRANSMISSION_EMBEDS_UPDATE')).toBeTruthy();
    expect(JSON.stringify(bot.got)).not.toMatch(/secret/);
  });

  it('@everyone and role mentions do not unlock text; mentions of the bot, its own messages and DMs do', async () => {
    const bot = await connect('bot', 'Bot tok');
    server.deliverDispatch(relayMsg({ id: 'e', mentionEveryone: true, mentionRoles: ['role-of-bot'] }) as any);
    server.deliverDispatch(relayMsg({ id: 'm', mentions: ['bot'] }) as any);
    server.deliverDispatch(relayMsg({ id: 'o', author: { id: 'bot' } }) as any);
    server.deliverDispatch({ ...relayMsg({ id: 'd' }), channelType: 'link', channelId: 'dm1' } as any);
    await expect.poll(() => bot.got.filter((g) => g.t === 'TRANSMISSION_CREATE').length).toBe(4);
    const byId = Object.fromEntries(bot.got.filter((g) => g.t === 'TRANSMISSION_CREATE').map((g) => [g.d.transmission.id, g.d.transmission.content]));
    expect(byId).toEqual({ e: '', m: 'secret text', o: 'secret text', d: 'secret text' });
    // A spoofed "own" flag inside a *mentioned* field does not matter: only author/transmitterId count.
    server.deliverDispatch(relayMsg({ id: 'x', author: { id: 'person', bot: true }, transmitterId: 'person' }) as any);
    await expect.poll(() => bot.got.filter((g) => g.t === 'TRANSMISSION_CREATE').length).toBe(5);
    expect(bot.last('TRANSMISSION_CREATE').transmission.content).toBe('');
  });

  it('losing the intent takes effect on the next event after a session refresh', async () => {
    intents.messageContent = true;
    const bot = await connect('bot', 'Bot tok');
    server.deliverDispatch(relayMsg({ id: 'before' }) as any);
    await expect.poll(() => bot.last('TRANSMISSION_CREATE')?.transmission.content).toBe('secret text');
    intents.messageContent = false;
    await server.refreshSessions(['bot']);
    server.deliverDispatch(relayMsg({ id: 'after' }) as any);
    await expect.poll(() => bot.last('TRANSMISSION_CREATE')?.transmission.id).toBe('after');
    expect(bot.last('TRANSMISSION_CREATE').transmission.content).toBe('');
  });

  it('activity: a bot without the Activity intent sees nobody’s activity; friends-only never reaches non-friends', async () => {
    const bot = await connect('bot', 'Bot tok');
    const friend = await connect('friend');
    const other = await connect('other'); // a presence peer of person, but not a friend
    const me = await connect('person');
    me.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.ACTIVITY_UPDATE, d: { activity: { name: 'Secret Game' } } }));
    await expect.poll(() => friend.last('USER_ACTIVITY_UPDATE')?.activity?.name).toBe('Secret Game');
    await new Promise((r) => setTimeout(r, 200));
    expect(JSON.stringify(bot.got)).not.toContain('Secret Game');
    expect(JSON.stringify(other.got)).not.toContain('Secret Game');
    // Going invisible hides it from everyone else.
    me.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.PRESENCE_UPDATE, d: { presence: 'invisible' } }));
    await expect.poll(() => friend.last('USER_ACTIVITY_UPDATE')?.activity).toBeNull();
  });

  it('op 3 presence updates are rate limited (5 per 20 s), and junk payloads are ignored', async () => {
    const me = await connect('person');
    for (let i = 0; i < 12; i++) me.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.PRESENCE_UPDATE, d: { presence: i % 2 ? 'online' : 'idle' } }));
    for (const junk of [{ op: GATEWAY_OPCODES.PRESENCE_UPDATE, d: { presence: '__proto__' } }, { op: GATEWAY_OPCODES.PRESENCE_UPDATE }, { op: 'x' }, { op: GATEWAY_OPCODES.ACTIVITY_UPDATE, d: { activity: { name: { toString: 1 } } } }]) me.ws.send(JSON.stringify(junk));
    me.ws.send('not json');
    await new Promise((r) => setTimeout(r, 300));
    expect(me.got.filter((g) => g.t === 'PRESENCE_CONFIRMATION').length).toBe(5);
    expect(me.closed()).toBeNull();
  });

  it('a bot token that no longer resolves cannot identify; repeat IDENTIFY cannot switch accounts', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    open.push(ws);
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    await new Promise<void>((r) => ws.on('open', () => r()));
    ws.send(JSON.stringify({ op: GATEWAY_OPCODES.IDENTIFY, d: { token: 'Bot old-token' } }));
    expect(await closed).toBe(4003);

    const me = await connect('person');
    me.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.IDENTIFY, d: { token: 'Bot tok' } }));
    server.deliverDispatch({ type: 'PING_TEST', audience: ['bot'] } as any);
    server.deliverDispatch({ type: 'PING_PERSON', audience: ['person'] } as any);
    await expect.poll(() => me.got.some((g) => g.t === 'PING_PERSON')).toBe(true);
    expect(me.got.some((g) => g.t === 'PING_TEST')).toBe(false);
  });
});
