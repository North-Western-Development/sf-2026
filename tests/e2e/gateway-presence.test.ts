import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createGatewayServer } from '../../apps/gateway-service/src/index.js';
import { GATEWAY_OPCODES, PRESENCE_STATES } from '@subspace/constants';
import { signAccessToken } from '@subspace/crypto';

describe('Gateway & Ghost Mode Presence Suite', () => {
  const TEST_PORT = 3999;
  const JWT_SECRET = 'subspace_jwt_super_secret_key_2026';
  let serverInstance: ReturnType<typeof createGatewayServer>;

  beforeAll(async () => {
    serverInstance = createGatewayServer(TEST_PORT);
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
});
