import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createGatewayServer, GatewayResolver } from '../../apps/gateway-service/src/index.js';
import { GATEWAY_OPCODES, PRESENCE_STATES } from '@subspace/constants';
import { signAccessToken } from '@subspace/crypto';

describe('Gateway & Ghost Mode Presence Suite', () => {
  const TEST_PORT = 3999;
  const JWT_SECRET = 'subspace_jwt_super_secret_key_2026';
  let serverInstance: ReturnType<typeof createGatewayServer>;

  // transmitter-a and transmitter-b share a beacon; outsider shares nothing with anyone.
  const resolver: GatewayResolver = {
    getPresencePeers: async (id) =>
      id === 'transmitter-a' ? ['transmitter-b'] : id === 'transmitter-b' ? ['transmitter-a'] : [],
    getBeaconIds: async (id) => (id === 'outsider' ? [] : ['beacon-1']),
    authorizeVoice: async (id, relayId) =>
      relayId === 'voice-1' && id !== 'outsider' ? 'beacon-1' : null,
  };

  beforeAll(async () => {
    serverInstance = createGatewayServer(TEST_PORT, { redis: false, resolver });
  });

  afterAll(async () => {
    await serverInstance.close();
  });

  it('performs connection handshake and IDENTIFY authentication', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);

    const receivedMessages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        // Authenticate with IDENTIFY opcode
        const token = signAccessToken(
          {
            transmitterId: 't1-uuid',
            username: 'spock',
            staffRank: 0,
          },
          JWT_SECRET
        );

        ws.send(
          JSON.stringify({
            op: GATEWAY_OPCODES.IDENTIFY,
            d: {
              token,
              presence: PRESENCE_STATES.ONLINE,
            },
          })
        );
      });

      ws.on('message', (data) => {
        const payload = JSON.parse(data.toString());
        receivedMessages.push(payload);
        if (payload.t === 'READY') {
          resolve();
        }
      });

      ws.on('error', reject);
    });

    ws.close();

    // Verify HELLO opcode received on connect
    const helloMsg = receivedMessages.find((m) => m.op === GATEWAY_OPCODES.HELLO);
    expect(helloMsg).toBeDefined();
    expect(helloMsg.d.heartbeat_interval).toBe(30000);

    // Verify READY event received after IDENTIFY
    const readyMsg = receivedMessages.find((m) => m.t === 'READY');
    expect(readyMsg).toBeDefined();
    expect(readyMsg.d.transmitter.username).toBe('spock');
  });

  it('Ghost Mode: strictly masks invisible state as offline to other transmitters', async () => {
    const tokenA = signAccessToken(
      { transmitterId: 'transmitter-a', username: 'ghost_pilot', staffRank: 0 },
      JWT_SECRET
    );
    const tokenB = signAccessToken(
      { transmitterId: 'transmitter-b', username: 'observer', staffRank: 0 },
      JWT_SECRET
    );

    const clientA = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    const clientB = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);

    // Wait for both to connect and authenticate
    await Promise.all([
      new Promise<void>((resolve) => {
        clientA.on('open', () => {
          clientA.send(
            JSON.stringify({
              op: GATEWAY_OPCODES.IDENTIFY,
              d: { token: tokenA, presence: PRESENCE_STATES.ONLINE },
            })
          );
        });
        clientA.on('message', (data) => {
          const p = JSON.parse(data.toString());
          if (p.t === 'READY') resolve();
        });
      }),
      new Promise<void>((resolve) => {
        clientB.on('open', () => {
          clientB.send(
            JSON.stringify({
              op: GATEWAY_OPCODES.IDENTIFY,
              d: { token: tokenB, presence: PRESENCE_STATES.ONLINE },
            })
          );
        });
        clientB.on('message', (data) => {
          const p = JSON.parse(data.toString());
          if (p.t === 'READY') resolve();
        });
      }),
    ]);

    // Track messages received on Client A (the sender) and Client B (the peer)
    let confirmationForA: any = null;
    let peerBroadcastForB: any = null;

    clientA.on('message', (data) => {
      const p = JSON.parse(data.toString());
      if (p.t === 'PRESENCE_CONFIRMATION') {
        confirmationForA = p;
      }
    });

    const broadcastPromise = new Promise<void>((resolve) => {
      clientB.on('message', (data) => {
        const p = JSON.parse(data.toString());
        if (p.t === 'PRESENCE_UPDATE' && p.d.transmitter_id === 'transmitter-a') {
          peerBroadcastForB = p;
          resolve();
        }
      });
    });

    // Client A engages Ghost Mode (sets presence to 'invisible')
    clientA.send(
      JSON.stringify({
        op: GATEWAY_OPCODES.PRESENCE_UPDATE,
        d: { presence: PRESENCE_STATES.INVISIBLE },
      })
    );

    await broadcastPromise;

    // Assertions:
    // 1. Client A receives confirmation that they are in fact 'invisible'
    expect(confirmationForA).toBeDefined();
    expect(confirmationForA.d.presence).toBe('invisible');

    // 2. Client B strictly receives 'offline' for Client A, never 'invisible'
    expect(peerBroadcastForB).toBeDefined();
    expect(peerBroadcastForB.d.presence).toBe('offline');
    expect(peerBroadcastForB.d.transmitter_id).toBe('transmitter-a');

    clientA.close();
    clientB.close();
  });

  // ---- Scoping (security) ----

  const connect = (transmitterId: string, username = transmitterId) =>
    new Promise<{ ws: WebSocket; messages: any[]; ready: any }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      const messages: any[] = [];
      ws.on('open', () => {
        const token = signAccessToken({ transmitterId, username, staffRank: 0 }, JWT_SECRET);
        ws.send(JSON.stringify({ op: GATEWAY_OPCODES.IDENTIFY, d: { token, presence: 'online' } }));
      });
      ws.on('message', (data) => {
        const p = JSON.parse(data.toString());
        messages.push(p);
        if (p.t === 'READY') resolve({ ws, messages, ready: p });
      });
      ws.on('error', reject);
    });
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it('does not leak presence to transmitters without a shared relationship', async () => {
    const outsider = await connect('outsider');
    const a = await connect('transmitter-a');
    await settle();
    a.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.PRESENCE_UPDATE, d: { presence: 'idle' } }));
    await settle();
    expect(outsider.messages.some((m) => m.t === 'PRESENCE_UPDATE')).toBe(false);
    a.ws.close();
    outsider.ws.close();
  });

  it('includes only peer presences in the READY snapshot', async () => {
    const a = await connect('transmitter-a');
    const b = await connect('transmitter-b');
    const outsider = await connect('outsider');
    expect(b.ready.d.presences.map((p: any) => p.transmitter_id)).toContain('transmitter-a');
    expect(outsider.ready.d.presences).toEqual([]);
    [a, b, outsider].forEach((c) => c.ws.close());
  });

  it('rejects voice state for relays the transmitter cannot join and scopes voice broadcasts', async () => {
    const outsider = await connect('outsider');
    const a = await connect('transmitter-a');
    const b = await connect('transmitter-b');

    outsider.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.VOICE_STATE_UPDATE, d: { relay_id: 'voice-1' } }));
    a.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.VOICE_STATE_UPDATE, d: { relay_id: 'voice-1' } }));
    await settle();

    expect(outsider.messages.some((m) => m.t === 'VOICE_STATE_REJECTED')).toBe(true);
    const bVoice = b.messages.filter((m) => m.t === 'VOICE_STATE_UPDATE');
    expect(bVoice.map((m) => m.d.transmitter_id)).toEqual(['transmitter-a']);
    expect(outsider.messages.some((m) => m.t === 'VOICE_STATE_UPDATE')).toBe(false);
    [a, b, outsider].forEach((c) => c.ws.close());
  });

  it('delivers dispatch events only to the attached audience and drops audience-less events', async () => {
    const a = await connect('transmitter-a');
    const b = await connect('transmitter-b');
    serverInstance.deliverDispatch({ type: 'TRANSMISSION_CREATE', audience: ['transmitter-b'] } as any);
    serverInstance.deliverDispatch({ type: 'TRANSMISSION_CREATE' } as any);
    await settle();
    const bEvents = b.messages.filter((m) => m.t === 'TRANSMISSION_CREATE');
    expect(bEvents).toHaveLength(1);
    expect(bEvents[0].d.audience).toBeUndefined();
    expect(a.messages.some((m) => m.t === 'TRANSMISSION_CREATE')).toBe(false);
    a.ws.close();
    b.ws.close();
  });

  it('delivers each presence update exactly once', async () => {
    const a = await connect('transmitter-a');
    const b = await connect('transmitter-b');
    await settle();
    const before = b.messages.length;
    a.ws.send(JSON.stringify({ op: GATEWAY_OPCODES.PRESENCE_UPDATE, d: { presence: 'away' } }));
    await settle();
    const updates = b.messages.slice(before).filter((m) => m.t === 'PRESENCE_UPDATE' && m.d.presence === 'away');
    expect(updates).toHaveLength(1);
    a.ws.close();
    b.ws.close();
  });
});
