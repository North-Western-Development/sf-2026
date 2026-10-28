import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createGatewayServer, GatewayResolver } from '../../apps/gateway-service/src/index.js';
import { GATEWAY_OPCODES, PRESENCE_STATES, type ActivityVisibility } from '@subspace/constants';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';

/**
 * Activity status over the gateway. gamer shares a beacon with friend and acquaintance, and is
 * affiliated (friends) with friend only; stranger shares nothing with anyone.
 */
describe('Gateway activity status and Activity Privacy', () => {
  const PORT = 3997;
  const visibility: Record<string, ActivityVisibility> = { gamer: 'everyone' };
  const peers: Record<string, string[]> = {
    gamer: ['friend', 'acquaintance', 'bot'],
    friend: ['gamer', 'acquaintance'],
    bot: ['gamer'],
    acquaintance: ['gamer', 'friend'],
    stranger: [],
  };
  const friends: Record<string, string[]> = { gamer: ['friend'], friend: ['gamer'] };
  const resolver: GatewayResolver = {
    getPresencePeers: async (id) => peers[id] ?? [],
    getBeaconIds: async (id) => (id === 'stranger' ? [] : ['beacon-1']),
    getFriendIds: async (id) => friends[id] ?? [],
    getActivityVisibility: async (id) => visibility[id] ?? 'off',
    authorizeVoice: async () => null,
    canPrioritySpeak: async () => false,
    authorizeCall: async () => null,
    finishCall: async () => {},
    resolveBot: async (token) => (token === 'bot-token' ? { transmitterId: 'bot', username: 'bot', ...botIntents } : null),
    getBotIntents: async () => ({ ...botIntents }),
  };
  const botIntents = { messageContent: false, activity: false };
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
    visibility.gamer = 'everyone';
    botIntents.activity = false;
    // Let the gateway see the sockets close before the next test.
    await new Promise((r) => setTimeout(r, 100));
  });

  /** A connected client that records every USER_ACTIVITY_UPDATE it receives. */
  async function connect(id: string, presence: string = PRESENCE_STATES.ONLINE, token?: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    open.push(ws);
    const updates: Array<{ transmitter_id: string; activity: any }> = [];
    let ready: any;
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.t === 'USER_ACTIVITY_UPDATE') updates.push(msg.d);
      if (msg.t === 'READY') ready = msg.d;
    });
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    ws.send(JSON.stringify({ op: GATEWAY_OPCODES.IDENTIFY, d: { token: token ?? signAccessToken({ transmitterId: id, username: id, staffRank: 0 }, getJwtSecret()), presence } }));
    await expect.poll(() => ready).toBeTruthy();
    const play = (activity: unknown) => ws.send(JSON.stringify({ op: GATEWAY_OPCODES.ACTIVITY_UPDATE, d: { activity } }));
    const last = (who: string) => updates.filter((u) => u.transmitter_id === who).at(-1);
    return { ws, updates, ready: () => ready, play, last };
  }

  const settle = () => new Promise((r) => setTimeout(r, 150));

  it('shares with everyone who sees my presence, and with my other devices', async () => {
    const friend = await connect('friend');
    const acquaintance = await connect('acquaintance');
    const stranger = await connect('stranger');
    const gamer = await connect('gamer');
    const otherDevice = await connect('gamer');
    gamer.play({ name: 'Counter-Strike 2', details: 'Competitive', startedAt: Date.now() });
    await expect.poll(() => friend.last('gamer')?.activity?.name).toBe('Counter-Strike 2');
    await expect.poll(() => acquaintance.last('gamer')?.activity?.details).toBe('Competitive');
    await expect.poll(() => otherDevice.last('gamer')?.activity?.name).toBe('Counter-Strike 2');
    await settle();
    expect(stranger.updates).toHaveLength(0);

    // Someone connecting later gets it in READY.
    const late = await connect('acquaintance');
    expect(late.ready().activities).toEqual([{ transmitter_id: 'gamer', activity: expect.objectContaining({ name: 'Counter-Strike 2' }) }]);
  });

  it('shares nothing while Activity Privacy is off', async () => {
    visibility.gamer = 'off';
    const friend = await connect('friend');
    const gamer = await connect('gamer');
    gamer.play({ name: 'Elden Ring' });
    await settle();
    expect(friend.updates).toHaveLength(0);
  });

  it('friends only: affiliates see it, other beacon members do not', async () => {
    visibility.gamer = 'friends';
    const friend = await connect('friend');
    const acquaintance = await connect('acquaintance');
    const gamer = await connect('gamer');
    gamer.play({ name: 'Elden Ring' });
    await expect.poll(() => friend.last('gamer')?.activity?.name).toBe('Elden Ring');
    await settle();
    expect(acquaintance.updates).toHaveLength(0);
  });

  it('narrowing to friends takes it away from everyone else at once', async () => {
    const friend = await connect('friend');
    const acquaintance = await connect('acquaintance');
    const gamer = await connect('gamer');
    gamer.play({ name: 'Hades II' });
    await expect.poll(() => acquaintance.last('gamer')?.activity?.name).toBe('Hades II');

    visibility.gamer = 'friends';
    await server.refreshSessions(['gamer']);
    await expect.poll(() => acquaintance.last('gamer')).toEqual({ transmitter_id: 'gamer', activity: null });
    expect(friend.last('gamer')?.activity?.name).toBe('Hades II');

    visibility.gamer = 'off';
    await server.refreshSessions(['gamer']);
    await expect.poll(() => friend.last('gamer')).toEqual({ transmitter_id: 'gamer', activity: null });
  });

  it('going invisible hides it, coming back shows it again', async () => {
    const friend = await connect('friend');
    const gamer = await connect('gamer');
    gamer.play({ name: 'Balatro' });
    await expect.poll(() => friend.last('gamer')?.activity?.name).toBe('Balatro');
    gamer.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.PRESENCE_UPDATE, d: { presence: PRESENCE_STATES.INVISIBLE } }));
    await expect.poll(() => friend.last('gamer')?.activity).toBeNull();
    gamer.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.PRESENCE_UPDATE, d: { presence: PRESENCE_STATES.ONLINE } }));
    await expect.poll(() => friend.last('gamer')?.activity?.name).toBe('Balatro');
  });

  it('ends when they stop playing or disconnect, and is never sent unsanitized', async () => {
    const friend = await connect('friend');
    const gamer = await connect('gamer');
    gamer.play({ name: 'Terraria', largeImage: 'http://tracker.example/pixel.png', buttons: [{ label: 'x', url: 'javascript:alert(1)' }] });
    await expect.poll(() => friend.last('gamer')?.activity?.name).toBe('Terraria');
    expect(friend.last('gamer')!.activity).toEqual({ type: 'playing', name: 'Terraria', source: 'detected' });

    gamer.play(null);
    await expect.poll(() => friend.last('gamer')?.activity).toBeNull();

    gamer.play({ name: 'Factorio' });
    // Updates are spaced two seconds apart.
    await expect.poll(() => friend.last('gamer')?.activity?.name, { timeout: 3000 }).toBe('Factorio');
    gamer.ws.close();
    await expect.poll(() => friend.last('gamer')?.activity).toBeNull();
  });

  it('keeps to one update every two seconds, always ending on the latest', async () => {
    const friend = await connect('friend');
    const gamer = await connect('gamer');
    for (let i = 1; i <= 5; i++) gamer.play({ name: 'osu!', details: `Combo ${i}` });
    await expect.poll(() => friend.last('gamer')?.activity?.details, { timeout: 4000 }).toBe('Combo 5');
    expect(friend.updates.length).toBeLessThanOrEqual(2);
  });

  it('bots see activity only with the Activity Status intent', async () => {
    const bot = await connect('bot', PRESENCE_STATES.ONLINE, 'Bot bot-token');
    const gamer = await connect('gamer');
    gamer.play({ name: 'Stardew Valley' });
    await settle();
    expect(bot.updates).toHaveLength(0);

    // Granted (the developer turned it on, or got verified): it gets the current activity at once.
    botIntents.activity = true;
    let refreshed: any;
    bot.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.t === 'RELATIONSHIPS_REFRESH') refreshed = msg.d;
    });
    await server.refreshSessions(['bot']);
    await expect.poll(() => refreshed?.activities).toEqual([{ transmitter_id: 'gamer', activity: expect.objectContaining({ name: 'Stardew Valley' }) }]);
    gamer.play({ name: 'Stardew Valley', details: 'Fishing' });
    await expect.poll(() => bot.last('gamer')?.activity?.details, { timeout: 3000 }).toBe('Fishing');
  });
});
