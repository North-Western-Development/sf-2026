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
  voiceRelayId?: string | null;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
}

export function createGatewayServer(customPort = port) {
  const wss = new WebSocketServer({ port: customPort });
  const sessions = new Map<WebSocket, Session>();
  const voiceStates = new Map<string, {
    transmitterId: string;
    username: string;
    relayId: string;
    isMuted: boolean;
    isDeafened: boolean;
    isSpeaking: boolean;
  }>();

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

    redisPub.on('error', () => {});
    redisSub.on('error', () => {});

    redisPub.connect().catch((err: any) => {
      console.warn('[Gateway] Redis Pub connection delayed:', err.message);
    });

    redisSub.connect().then(() => {
      redisSub?.subscribe('gateway:presence:events', 'gateway:voice:events', (err) => {
        if (err) console.warn('[Gateway] Redis Sub subscription error:', err);
      });

      redisSub?.on('message', (channel, message) => {
        if (channel === 'gateway:presence:events') {
          try {
            const event = JSON.parse(message);
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
        } else if (channel === 'gateway:voice:events') {
          try {
            const event = JSON.parse(message);
            if (event.relay_id) {
              voiceStates.set(event.transmitter_id, {
                transmitterId: event.transmitter_id,
                username: event.username,
                relayId: event.relay_id,
                isMuted: !!event.is_muted,
                isDeafened: !!event.is_deafened,
                isSpeaking: !!event.is_speaking,
              });
            } else {
              voiceStates.delete(event.transmitter_id);
            }
            wss.clients.forEach((client) => {
              const sess = sessions.get(client);
              if (sess && sess.isAuthenticated) {
                client.send(
                  JSON.stringify({
                    op: GATEWAY_OPCODES.DISPATCH,
                    t: 'VOICE_STATE_UPDATE',
                    d: event,
                  })
                );
              }
            });
          } catch (e) {
            console.warn('[Gateway] Error parsing redis voice event:', e);
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
                voice_states: Array.from(voiceStates.values()),
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

        // VOICE_STATE_UPDATE
        if (payload.op === GATEWAY_OPCODES.VOICE_STATE_UPDATE) {
          const { relay_id, is_muted, is_deafened, is_speaking } = payload.d || {};
          session.voiceRelayId = relay_id || null;
          session.isMuted = !!is_muted;
          session.isDeafened = !!is_deafened;
          session.isSpeaking = !!is_speaking;

          if (session.transmitterId) {
            broadcastVoiceStateUpdate(
              session.transmitterId,
              session.username || 'Transmitter',
              session.voiceRelayId,
              session.isMuted,
              session.isDeafened,
              session.isSpeaking
            );
          }
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
        if (session.voiceRelayId) {
          broadcastVoiceStateUpdate(
            session.transmitterId,
            session.username || 'Transmitter',
            null,
            false,
            false,
            false
          );
        }
      }
      sessions.delete(ws);
      clearTimeout(authTimeout);
    });
  });

  function broadcastVoiceStateUpdate(
    transmitterId: string,
    username: string,
    relayId: string | null | undefined,
    isMuted: boolean = false,
    isDeafened: boolean = false,
    isSpeaking: boolean = false
  ) {
    const activeRelayId = relayId || null;
    if (activeRelayId) {
      voiceStates.set(transmitterId, {
        transmitterId,
        username,
        relayId: activeRelayId,
        isMuted,
        isDeafened,
        isSpeaking,
      });
    } else {
      voiceStates.delete(transmitterId);
    }

    const eventPayload = {
      transmitter_id: transmitterId,
      username,
      relay_id: activeRelayId,
      is_muted: isMuted,
      is_deafened: isDeafened,
      is_speaking: isSpeaking,
      timestamp: new Date().toISOString(),
    };

    if (redisPub && (redisPub as any).status === 'ready') {
      redisPub.publish('gateway:voice:events', JSON.stringify(eventPayload)).catch(() => {});
    }

    wss.clients.forEach((client) => {
      const sess = sessions.get(client);
      if (sess && sess.isAuthenticated) {
        client.send(
          JSON.stringify({
            op: GATEWAY_OPCODES.DISPATCH,
            t: 'VOICE_STATE_UPDATE',
            d: eventPayload,
          })
        );
      }
    });
  }

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

    // If redis is available and connected, publish through event bus
    if (redisPub && (redisPub as any).status === 'ready') {
      redisPub.publish('gateway:presence:events', JSON.stringify(eventPayload)).catch(() => {});
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

  const close = async () => {
    clearInterval(interval);
    for (const ws of wss.clients) {
      ws.terminate();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    if (redisPub) {
      try { await redisPub.quit(); } catch { redisPub.disconnect(); }
    }
    if (redisSub) {
      try { await redisSub.quit(); } catch { redisSub.disconnect(); }
    }
  };

  wss.on('close', () => {
    clearInterval(interval);
    if (redisPub) redisPub.disconnect();
    if (redisSub) redisSub.disconnect();
  });

  console.log(`[Gateway Service] Subspace Gateway listening on port ${customPort}`);
  return { wss, sessions, close };
}

if (process.env.NODE_ENV !== 'test') {
  createGatewayServer();
}
