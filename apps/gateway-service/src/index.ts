import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { GATEWAY_OPCODES, PRESENCE_STATES, PresenceState } from '@subspace/constants';
import { Redis } from 'ioredis';

dotenv.config();

const port = Number(process.env.GATEWAY_PORT) || 3002;
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

interface Session {
  transmitterId?: string;
  presence: PresenceState;
  isAlive: boolean;
}

export function createGatewayServer() {
  const wss = new WebSocketServer({ port });
  const sessions = new Map<WebSocket, Session>();

  let redisPub: Redis | null = null;

  try {
    redisPub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    redisPub.connect().catch((err: any) => {
      console.warn('[Gateway] Redis Pub connection delayed:', err.message);
    });
  } catch (err) {
    console.warn('[Gateway] Redis Pub setup warning:', err);
  }

  wss.on('connection', (ws: WebSocket) => {
    sessions.set(ws, {
      presence: PRESENCE_STATES.ONLINE,
      isAlive: true,
    });

    // Send HELLO opcode on handshake
    ws.send(
      JSON.stringify({
        op: GATEWAY_OPCODES.HELLO,
        d: {
          heartbeat_interval: 30000,
        },
      })
    );

    ws.on('pong', () => {
      const session = sessions.get(ws);
      if (session) session.isAlive = true;
    });

    ws.on('message', (data: string) => {
      try {
        const payload = JSON.parse(data.toString());
        const session = sessions.get(ws);

        if (payload.op === GATEWAY_OPCODES.HEARTBEAT) {
          if (session) session.isAlive = true;
          ws.send(JSON.stringify({ op: GATEWAY_OPCODES.HEARTBEAT_ACK }));
          return;
        }

        if (payload.op === GATEWAY_OPCODES.PRESENCE_UPDATE) {
          const newPresence = payload.d?.presence as PresenceState;
          if (session && Object.values(PRESENCE_STATES).includes(newPresence)) {
            session.presence = newPresence;

            // Ghost Mode Engine:
            // Broadcast strictly 'offline' to peers if user goes 'invisible'
            const broadcastPresence =
              newPresence === PRESENCE_STATES.INVISIBLE
                ? PRESENCE_STATES.OFFLINE
                : newPresence;

            // Echo true presence only to sender
            ws.send(
              JSON.stringify({
                op: GATEWAY_OPCODES.DISPATCH,
                t: 'PRESENCE_CONFIRMATION',
                d: { presence: newPresence },
              })
            );

            // Publish broadcast payload to Redis bus
            if (redisPub && session.transmitterId) {
              redisPub.publish(
                'gateway:presence:events',
                JSON.stringify({
                  transmitter_id: session.transmitterId,
                  presence: broadcastPresence,
                })
              );
            }
          }
        }
      } catch (err) {
        console.warn('[Gateway] Malformed message payload:', err);
      }
    });

    ws.on('close', () => {
      sessions.delete(ws);
    });
  });

  // Keep-alive heartbeat monitor
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const session = sessions.get(ws);
      if (session && !session.isAlive) {
        ws.terminate();
        sessions.delete(ws);
        return;
      }
      if (session) session.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
    if (redisPub) redisPub.disconnect();
  });

  console.log(`[Gateway Service] Subspace Gateway listening on port ${port}`);
  return { wss, sessions };
}

if (process.env.NODE_ENV !== 'test') {
  createGatewayServer();
}
