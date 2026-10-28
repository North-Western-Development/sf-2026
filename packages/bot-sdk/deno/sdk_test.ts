// Runs the SDK source unchanged under Deno against an in-process fake instance (REST + gateway).
//   deno test --allow-net deno/
import { assert, assertEquals } from './assert.ts';
import { deferWith, Interaction, respondWith, SubspaceApiError, SubspaceBot, verifyInteraction, verifyInteractionAsync, type Message } from '../src/index.ts';

const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function keyPair() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKeyHex = toHex(await crypto.subtle.exportKey('raw', kp.publicKey));
  const sign = async (msg: string) => toHex(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(msg)));
  return { publicKeyHex, sign };
}

Deno.test('verifyInteraction and verifyInteractionAsync accept a good signature and refuse forgeries', async () => {
  const { publicKeyHex, sign } = await keyPair();
  const body = '{"type":2,"id":"1"}';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await sign(ts + body);
  assert(verifyInteraction(body, sig, ts, publicKeyHex));
  assert(await verifyInteractionAsync(body, sig, ts, publicKeyHex));
  assert(!verifyInteraction(body + ' ', sig, ts, publicKeyHex));
  assert(!(await verifyInteractionAsync(body + ' ', sig, ts, publicKeyHex)));
  // Too old, even when signed.
  const old = String(Math.floor(Date.now() / 1000) - 301);
  assert(!verifyInteraction(body, await sign(old + body), old, publicKeyHex));
  assert(!verifyInteraction(body, 'zz', ts, publicKeyHex));
  assert(!(await verifyInteractionAsync(body, sig, ts, 'nothex')));
});

Deno.test('respondWith / deferWith build interaction responses', () => {
  assertEquals(respondWith('hi'), { type: 4, data: { content: 'hi' } });
  assertEquals(respondWith({ content: 'x', ephemeral: true }), { type: 4, data: { content: 'x', ephemeral: true } });
  assertEquals(deferWith(), { type: 5, data: {} });
});

Deno.test('REST, gateway, messages and interactions against a fake instance', async () => {
  const calls: Array<{ method: string; path: string; auth: string | null; body: any }> = [];
  let identifyToken = '';
  let heartbeats = 0;
  let gatewaySocket: WebSocket | null = null;

  const server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/gateway') {
      const { socket, response } = Deno.upgradeWebSocket(req);
      gatewaySocket = socket;
      socket.onopen = () => socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 50 } }));
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.op === 1) heartbeats++;
        if (msg.op === 2) {
          identifyToken = msg.d.token;
          socket.send(JSON.stringify({ op: 0, t: 'READY', d: { transmitter: { id: '10', username: 'dice' }, session_id: 's' } }));
        }
      };
      return response;
    }
    const text = await req.text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, path: url.pathname, auth: req.headers.get('authorization'), body });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/v1/bots/@me') {
      return req.headers.get('authorization') === 'Bot good' ? json({ bot: { id: '10', username: 'dice', appId: '20', beaconIds: ['30'] } }) : json({ error: 'Invalid bot token', code: 'INVALID_BOT_TOKEN' }, 401);
    }
    if (url.pathname === '/api/v1/applications/20/commands' && req.method === 'PUT') return json({ commands: body.map((c: any, i: number) => ({ id: String(100 + i), ...c })) });
    if (url.pathname === '/api/v1/channels/relay/40/transmissions') return json({ transmission: { id: '50', content: body.content } });
    if (url.pathname.startsWith('/api/v1/transmissions/')) return new Response(null, { status: 204 });
    if (url.pathname.startsWith('/api/v1/interactions/')) return new Response(null, { status: 204 });
    return json({ error: 'Not found' }, 404);
  });
  const base = `http://127.0.0.1:${server.addr.port}`;

  try {
    // A bad token surfaces as SubspaceApiError.
    const bad = new SubspaceBot({ token: 'nope', baseUrl: base });
    const err = await bad.me().catch((e) => e);
    assert(err instanceof SubspaceApiError);
    assertEquals([err.status, err.code], [401, 'INVALID_BOT_TOKEN']);

    const bot = new SubspaceBot({ token: 'good', baseUrl: base });
    const cmds = await bot.registerCommands([{ name: 'roll', description: 'Roll', options: [{ type: 'integer', name: 'sides', description: 'Sides' }] }]);
    assertEquals(cmds[0].id, '100');
    const sent = await bot.send('relay', '40', 'hello');
    assertEquals(sent.content, 'hello');
    await bot.edit('50', 'edited');
    await bot.react('50', '👍');
    await bot.delete('50');

    const ready = new Promise((r) => bot.once('ready', r));
    await bot.connect();
    await ready;
    assertEquals(identifyToken, 'Bot good');

    const gotMessage = new Promise<Message>((r) => bot.once('message', r));
    const gotInteraction = new Promise<Interaction>((r) => bot.once('interaction', r));
    const dispatched: string[] = [];
    bot.on('dispatch', (t: string) => dispatched.push(t));
    gatewaySocket!.send(JSON.stringify({ op: 0, t: 'TRANSMISSION_CREATE', d: { channelType: 'relay', channelId: '40', transmission: { id: '51', content: '!hello', author: { id: '7', username: 'sam' } } } }));
    gatewaySocket!.send(
      JSON.stringify({ op: 0, t: 'INTERACTION_CREATE', d: { type: 2, id: '60', token: 'itok', applicationId: '20', beaconId: '30', channel: { type: 'relay', id: '40' }, user: { id: '7', username: 'sam' }, memberPermissions: '0', data: { id: '100', name: 'roll', options: [{ name: 'sides', type: 'integer', value: 20 }] } } }),
    );
    const m = await gotMessage;
    assertEquals([m.channelType, m.channelId, m.content], ['relay', '40', '!hello']);
    const i = await gotInteraction;
    assertEquals([i.commandName, i.option<number>('sides'), i.option('missing')], ['roll', 20, undefined]);
    await i.reply('Rolled 7');
    await i.followUp({ content: 'more' });
    await i.editReply('changed');
    assertEquals(dispatched, ['TRANSMISSION_CREATE', 'INTERACTION_CREATE']);

    await new Promise((r) => setTimeout(r, 160));
    assert(heartbeats >= 1, 'heartbeats were sent');

    const closed = new Promise((r) => bot.once('close', r));
    bot.disconnect();
    await closed;

    const byPath = (p: string) => calls.filter((c) => c.path === p);
    assertEquals(byPath('/api/v1/channels/relay/40/transmissions')[0].auth, 'Bot good');
    const cb = byPath('/api/v1/interactions/60/itok/callback')[0];
    assertEquals(cb.body, { type: 4, data: { content: 'Rolled 7' } });
    assertEquals(cb.auth, null);
    assertEquals(byPath('/api/v1/interactions/60/itok/followup')[0].body, { content: 'more' });
    assertEquals(calls.find((c) => c.path === '/api/v1/interactions/60/itok/original')?.method, 'PATCH');
    assertEquals(calls.find((c) => c.path.includes('/reactions/'))?.path, '/api/v1/transmissions/50/reactions/%F0%9F%91%8D/@me');
  } finally {
    await server.shutdown();
  }
});
