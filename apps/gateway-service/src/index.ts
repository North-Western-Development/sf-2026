import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { GATEWAY_OPCODES, PRESENCE_STATES, PresenceState } from '@subspace/constants';
import { verifyToken, TokenPayload } from '@subspace/crypto';
import { Redis } from 'ioredis';

dotenv.config();

const port = Number(process.env.GATEWAY_PORT) || 3002;
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';

export interface Session {
  transmitterId?: string;
  username?: string;
  presence: PresenceState;
  isAuthenticated: boolean;
  isAlive: boolean;
}

export function createGatewayServer(customPort = port) {
  const wss = new WebSocketServer({ port: customPort });
  const sessions = new Map<WebSocket, Session>();

  let redisPub: Redis | null = null;
  let redisSub: Redis | null = null;

  try {
    redisPub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    redisSub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    redisPub.connect().catch((err: any) => {
      console.warn('[Gateway] Redis Pub connection delayed:', err.message);
    });

    redisSub.connect().then(() => {
      redisSub?.subscribe('gateway:presence:events', (err) => {
        if (err) console.warn('[Gateway] Redis Sub subscription error:', err);
      });

      redisSub?.on('message', (channel, message) => {
        if (channel === 'gateway:presence:events') {
          try {
            const event = JSON.parse(message);
            // Broadcast to all authenticated connected sockets on this node
            wss.clients.forEach((client) => {
              const sess = sessions.get(client);
              if (sess && sess.isAuthenticated && sess.transmitterId !== event.transmitter_id) {
                client.send(
                  JSON.stringify({
                    op: GATEWAY_OPCODES.DISPATCH,
                    t: 'PRESENCE_UPDATE',
                    d: event,
                  })
                );
              }
            });
          } catch (e) {
            console.warn('[Gateway] Error parsing redis presence event:', e);
          }
        }
      });
    }).catch((err: any) => {
      console.warn('[Gateway] Redis Sub connection delayed:', err.message);
    });
  } catch (err) {
    console.warn('[Gateway] Redis setup warning:', err);
  }

  wss.on('connection', (ws: WebSocket) => {
    sessions.set(ws, {
      presence: PRESENCE_STATES.ONLINE,
      isAuthenticated: false,
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

    // Timeout if client does not IDENTIFY within 10 seconds
    const authTimeout = setTimeout(() => {
      const sess = sessions.get(ws);
      if (sess && !sess.isAuthenticated) {
        ws.close(4001, 'Authentication Timeout: IDENTIFY payload required');
      }
    }, 10000);

    ws.on('pong', () => {
      const session = sessions.get(ws);
      if (session) session.isAlive = true;
    });

    ws.on('message', (data: string) => {
      try {
        const payload = JSON.parse(data.toString());
        const session = sessions.get(ws);
        if (!session) return;

        // HEARTBEAT
        if (payload.op === GATEWAY_OPCODES.HEARTBEAT) {
          session.isAlive = true;
          ws.send(JSON.stringify({ op: GATEWAY_OPCODES.HEARTBEAT_ACK }));
          return;
        }

        // IDENTIFY
        if (payload.op === GATEWAY_OPCODES.IDENTIFY) {
          const token = payload.d?.token;
          if (!token) {
            ws.close(4002, 'Malformed IDENTIFY payload');
            return;
          }

          const decoded = verifyToken<TokenPayload>(token, JWT_SECRET);
          if (!decoded) {
            ws.close(4003, 'Invalid or expired authentication ticket');
            return;
          }

          clearTimeout(authTimeout);
          session.isAuthenticated = true;
          session.transmitterId = decoded.transmitterId;
          session.username = decoded.username;
          session.presence = (payload.d?.presence as PresenceState) || PRESENCE_STATES.ONLINE;

          // Reply with READY dispatch
          ws.send(
            JSON.stringify({
              op: GATEWAY_OPCODES.DISPATCH,
              t: 'READY',
              d: {
                transmitter: {
                  id: session.transmitterId,
                  username: session.username,
                },
                presence: session.presence,
                session_id: `subspace_sess_${Date.now()}`,
              },
            })
          );

          // Broadcast initial presence
          if (session.transmitterId) {
            broadcastPresenceUpdate(session.transmitterId, session.presence);
          }
          return;
        }

        // Must be authenticated for subsequent actions
        if (!session.isAuthenticated) {
          ws.close(4004, 'Unauthenticated operation');
          return;
        }

        // PRESENCE_UPDATE
        if (payload.op === GATEWAY_OPCODES.PRESENCE_UPDATE) {
          const requestedPresence = payload.d?.presence as PresenceState;
          if (Object.values(PRESENCE_STATES).includes(requestedPresence)) {
            session.presence = requestedPresence;

            // Confirm true presence back to the requesting transmitter
            ws.send(
              JSON.stringify({
                op: GATEWAY_OPCODES.DISPATCH,
                t: 'PRESENCE_CONFIRMATION',
                d: { presence: requestedPresence },
              })
            );

            // Broadcast transformed presence via Ghost Mode Engine
            if (session.transmitterId) {
              broadcastPresenceUpdate(session.transmitterId, requestedPresence);
            }
          }
        }
      } catch (err) {
        console.warn('[Gateway] Malformed message payload:', err);
      }
    });

    ws.on('close', () => {
      const session = sessions.get(ws);
      if (session && session.transmitterId) {
        broadcastPresenceUpdate(session.transmitterId, PRESENCE_STATES.OFFLINE);
      }
      sessions.delete(ws);
      clearTimeout(authTimeout);
    });
  });

  /**
   * Ghost Mode Presence Transformation Engine:
   * If a Transmitter sets presence to 'invisible', peer clients strictly receive 'offline'.
   */
  function broadcastPresenceUpdate(transmitterId: string, presence: PresenceState) {
    const peerPresence =
      presence === PRESENCE_STATES.INVISIBLE ? PRESENCE_STATES.OFFLINE : presence;

    const eventPayload = {
      transmitter_id: transmitterId,
      presence: peerPresence,
      timestamp: new Date().toISOString(),
    };

    // If redis is available, publish through event bus
    if (redisPub) {
      redisPub.publish('gateway:presence:events', JSON.stringify(eventPayload));
    }

    // Direct local delivery to other connected clients on this instance
    wss.clients.forEach((client) => {
      const sess = sessions.get(client);
      if (sess && sess.isAuthenticated && sess.transmitterId !== transmitterId) {
        client.send(
          JSON.stringify({
            op: GATEWAY_OPCODES.DISPATCH,
            t: 'PRESENCE_UPDATE',
            d: eventPayload,
          })
        );
      }
    });
  }

  // Keep-alive heartbeat watchdog
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
    if (redisSub) redisSub.disconnect();
  });

  console.log(`[Gateway Service] Subspace Gateway listening on port ${customPort}`);
  return { wss, sessions };
}

if (process.env.NODE_ENV !== 'test') {
  createGatewayServer();
}
