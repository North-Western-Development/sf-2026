import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { createGatewayServer } from '../../apps/gateway-service/src/index.js';
import { SubspaceBot, verifyInteraction, respondWith, type Message } from '../../packages/bot-sdk/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, beacons, oauthApps, eq, or } from '@subspace/database';

const GATEWAY_PORT = 4567;
const until = async <T>(fn: () => Promise<T | undefined | null | false>, ms = 8000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** Bots, slash commands and interactions, over HTTP endpoints and the gateway. */
describe('Bots and interactions', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let gateway: ReturnType<typeof createGatewayServer>;
  let baseUrl = '';
  const dev = { id: '410148418031190017', username: 'bot_dev' };
  const member = { id: '410148418031190018', username: 'bot_member' };
  const stranger = { id: '410148418031190019', username: 'bot_stranger' };
  const users = [dev, member, stranger];
  const auth = (u: typeof dev) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: typeof dev | null, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: { ...(u ? auth(u) : {}), ...headers }, payload: payload as any });
  let beaconId = '';
  let general = '';
  let appId = '';
  let botToken = '';
  let botUserId = '';
  let publicKey = '';
  const messages = async () => (await call('GET', `/channels/relay/${general}/transmissions`, member)).json().transmissions as any[];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = 'localhost,127.0.0.1';
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(app.server.address() as any).port}`;
    gateway = createGatewayServer(GATEWAY_PORT);
    db = (app as any).db;
    if (!db) return;
    await db.delete(oauthApps).where(eq(oauthApps.ownerId, dev.id));
    await db.delete(beacons).where(eq(beacons.ownerId, dev.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true });
    beaconId = (await call('POST', '/beacons', dev, { name: 'Bot Lab', isDiscoverable: true })).json().beacon.id;
    general = (await call('GET', `/beacons/${beaconId}/relays`, dev)).json().relays.find((r: any) => r.type === 'text').id;
    await call('POST', `/beacons/${beaconId}/join`, member);
    await call('POST', `/beacons/${beaconId}/join`, stranger);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(oauthApps).where(eq(oauthApps.ownerId, dev.id));
      await db.delete(beacons).where(eq(beacons.ownerId, dev.id));
      await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    }
    await gateway?.close();
    await app.close();
  });

  it('creates a bot with a token that only reaches bot routes, and adds it to a beacon with its own clearance', async () => {
    if (!db) return;
    appId = (await call('POST', '/applications', dev, { name: 'Dice' })).json().application.id;
    const created = (await call('POST', `/applications/${appId}/bot`, dev)).json().bot;
    botToken = created.token;
    botUserId = created.userId;
    publicKey = created.publicKey;
    expect(publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect((await call('GET', `/applications/${appId}/bot`, dev)).json().bot).not.toHaveProperty('token');

    const asBot = { authorization: `Bot ${botToken}` };
    expect((await call('GET', '/bots/@me', null, undefined, asBot)).json().bot).toMatchObject({ id: botUserId, appId, beaconIds: [] });
    expect((await call('GET', '/bots/@me', null, undefined, { authorization: 'Bot nope' })).statusCode).toBe(401);
    expect((await call('PATCH', '/users/@me/profile', null, { bio: 'hi' }, asBot)).json().code).toBe('BOT_FORBIDDEN');

    // Private bot: only its developer adds it; others need Manage Beacon anyway.
    expect((await call('POST', `/beacons/${beaconId}/bots`, member, { appId })).json().code).toBe('MISSING_PERMISSIONS');
    const perms = (PERMISSIONS.VIEW_RELAY | PERMISSIONS.SEND_TRANSMISSIONS).toString();
    const added = (await call('POST', `/beacons/${beaconId}/bots`, dev, { appId, permissions: perms })).json();
    expect(added.added).toBe(true);
    const listed = (await call('GET', `/beacons/${beaconId}/members`, member)).json().members.find((m: any) => m.transmitterId === botUserId);
    expect(listed.user.botKind).toBe('bot');
    expect((await call('DELETE', `/beacons/${beaconId}/clearances/${added.clearanceId}`, dev)).json().code).toBe('MANAGED_CLEARANCE');
    expect((await call('POST', `/beacons/${beaconId}/clearances/members/${member.id}/assign`, dev, { clearanceId: added.clearanceId, action: 'add' })).json().code).toBe('MANAGED_CLEARANCE');

    const sent = (await call('POST', `/channels/relay/${general}/transmissions`, null, { content: 'beep boop' }, asBot)).json().transmission;
    expect(sent.author).toMatchObject({ id: botUserId, botKind: 'bot' });
  });

  it('registers commands, shows each member only the ones they may use, and checks options', async () => {
    if (!db) return;
    const bot = new SubspaceBot({ token: botToken, baseUrl });
    const commands = await bot.registerCommands([
      { name: 'roll', description: 'Roll a die', options: [{ type: 'integer', name: 'sides', description: 'How many sides', required: true }] },
      { name: 'purge', description: 'Moderators only', defaultMemberPermissions: PERMISSIONS.MANAGE_TRANSMISSIONS.toString() },
    ]);
    expect(commands.map((c) => c.name)).toEqual(['roll', 'purge']);
    // Overwriting keeps ids.
    const again = await bot.registerCommands([{ name: 'roll', description: 'Roll a die!', options: commands[0].options }]);
    expect(again[0].id).toBe(commands[0].id);
    await bot.registerCommands(commands.map(({ id: _id, ...c }) => c));

    const forMember = (await call('GET', `/beacons/${beaconId}/commands?relayId=${general}`, member)).json().commands.map((c: any) => c.name);
    expect(forMember).toEqual(['roll']);
    const forDev = (await call('GET', `/beacons/${beaconId}/commands?relayId=${general}`, dev)).json().commands.map((c: any) => c.name).sort();
    expect(forDev).toEqual(['purge', 'roll']);

    const roll = commands.find((c) => c.name === 'roll')!;
    expect((await call('POST', '/interactions', member, { commandId: roll.id, channelType: 'relay', channelId: general, options: {} })).json().code).toBe('INVALID_OPTION');
    expect((await call('POST', '/interactions', member, { commandId: roll.id, channelType: 'relay', channelId: general, options: { sides: 'six' } })).json().code).toBe('INVALID_OPTION');
    const purge = commands.find((c) => c.name === 'purge')!;
    expect((await call('POST', '/interactions', member, { commandId: purge.id, channelType: 'relay', channelId: general })).json().code).toBe('COMMAND_UNAVAILABLE');
  });

  it('delivers interactions to a signed HTTP endpoint and posts its answer', async () => {
    if (!db) return;
    let seenValid = false;
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seenValid = verifyInteraction(raw, String(req.headers['x-signature-ed25519']), String(req.headers['x-signature-timestamp']), publicKey);
        // A forged body fails the same check.
        expect(verifyInteraction(raw + ' ', String(req.headers['x-signature-ed25519']), String(req.headers['x-signature-timestamp']), publicKey)).toBe(false);
        const body = JSON.parse(raw);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(respondWith({ content: `Rolled a d${body.data.options[0].value}: 4`, embeds: [{ title: 'Dice', color: 0x3b8ef2 }] })));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(server.address() as any).port}/interactions`;
    expect((await call('PATCH', `/applications/${appId}/bot`, dev, { interactionsUrl: url })).json().bot.interactionsUrl).toBe(url);
    const roll = (await call('GET', `/beacons/${beaconId}/commands?relayId=${general}`, member)).json().commands.find((c: any) => c.name === 'roll');
    expect((await call('POST', '/interactions', member, { commandId: roll.id, channelType: 'relay', channelId: general, options: { sides: 20 } })).statusCode).toBe(202);
    const answer = await until(async () => (await messages()).find((t) => t.interaction?.name === 'roll'));
    expect(answer).toMatchObject({ content: 'Rolled a d20: 4', author: { id: botUserId }, interaction: { name: 'roll', user: { id: member.id } } });
    expect(answer.embeds[0]).toMatchObject({ type: 'rich', title: 'Dice' });
    expect(seenValid).toBe(true);
    server.close();
    await call('PATCH', `/applications/${appId}/bot`, dev, { interactionsUrl: null });
  });

  it('over the gateway: the bot answers, defers and follows up, and sees message text only when mentioned', async () => {
    if (!db) return;
    const bot = new SubspaceBot({ token: botToken, baseUrl, gatewayUrl: `ws://127.0.0.1:${GATEWAY_PORT}` });
    const seen: Message[] = [];
    const types: unknown[] = [];
    bot.on('message', (m: Message) => seen.push(m));
    bot.on('interaction', async (i) => {
      types.push((i.raw as { type?: unknown }).type);
      if (i.option<number>('sides') === 1) {
        await i.defer();
        await new Promise((r) => setTimeout(r, 300));
        await i.followUp('Took a while: 1');
      } else await i.reply({ content: `Gateway roll: ${i.option('sides')}` });
    });
    await bot.connect();
    try {
      const roll = (await call('GET', `/beacons/${beaconId}/commands?relayId=${general}`, member)).json().commands.find((c: any) => c.name === 'roll');
      await call('POST', '/interactions', member, { commandId: roll.id, channelType: 'relay', channelId: general, options: { sides: 8 } });
      await until(async () => (await messages()).find((t) => t.content === 'Gateway roll: 8'));
      await call('POST', '/interactions', member, { commandId: roll.id, channelType: 'relay', channelId: general, options: { sides: 1 } });
      await until(async () => (await messages()).find((t) => t.content === 'Took a while: 1'));
      // The interaction's own type (2, a command), not the event's name.
      expect(types).toEqual([2, 2]);

      // Without the Message Content intent, text arrives only where the bot is mentioned.
      await call('POST', `/channels/relay/${general}/transmissions`, member, { content: 'secret plans' });
      await call('POST', `/channels/relay/${general}/transmissions`, member, { content: `hey <@${botUserId}>` });
      await until(async () => seen.find((m) => m.content.startsWith('hey')));
      expect(seen.find((m) => m.content === 'secret plans')).toBeUndefined();
      // The other one arrived, without its text.
      expect(seen.some((m) => m.author.id === member.id && m.content === '')).toBe(true);
    } finally {
      bot.disconnect();
    }
  });

  it('a bot can post rich embeds; people cannot', async () => {
    if (!db) return;
    const asBot = { authorization: `Bot ${botToken}` };
    const sent = await call('POST', `/channels/relay/${general}/transmissions`, null, { embeds: [{ title: 'Server status', description: 'All green' }] }, asBot);
    expect(sent.statusCode).toBe(201);
    expect(sent.json().transmission.embeds).toEqual([expect.objectContaining({ type: 'rich', title: 'Server status' })]);
    const person = await call('POST', `/channels/relay/${general}/transmissions`, member, { content: 'hi', embeds: [{ title: 'Fake' }] });
    expect(person.json().code).toBe('EMBEDS_BOTS_ONLY');
  });

  it('a late answer is refused, and removing the bot takes its clearance', async () => {
    if (!db) return;
    const roll = (await call('GET', `/beacons/${beaconId}/commands?relayId=${general}`, member)).json().commands.find((c: any) => c.name === 'roll');
    expect((await call('POST', '/interactions/978275694148452352/nope/callback', null, { type: 4, data: { content: 'x' } })).json().code).toBe('UNKNOWN_INTERACTION');
    expect(roll).toBeTruthy();
    expect((await call('DELETE', `/beacons/${beaconId}/bots/${appId}`, member)).json().code).toBe('MISSING_PERMISSIONS');
    expect((await call('DELETE', `/beacons/${beaconId}/bots/${appId}`, dev)).json().removed).toBe(true);
    const clearanceNames = (await call('GET', `/beacons/${beaconId}/clearances`, dev)).json().clearances.map((c: any) => c.name);
    expect(clearanceNames).not.toContain('Dice');
    expect((await call('GET', `/beacons/${beaconId}/commands?relayId=${general}`, member)).json().commands).toEqual([]);
  });

});

