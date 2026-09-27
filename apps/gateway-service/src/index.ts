import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { GATEWAY_OPCODES, PRESENCE_STATES, PresenceState } from '@subspace/constants';
import { verifyToken, TokenPayload, getJwtSecret } from '@subspace/crypto';
import {
  createDatabaseClient,
  resolvePresencePeers,
  resolveTransmitterBeaconIds,
  authorizeVoiceRelay,
} from '@subspace/database';
import { Redis } from 'ioredis';

dotenv.config();

const port = Number(process.env.GATEWAY_PORT) || 3002;
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const JWT_SECRET = getJwtSecret();

const CHANNELS = {
  presence: 'gateway:presence:events',
  voice: 'gateway:voice:events',
  dispatch: 'gateway:transmission:events',
  session: 'gateway:session:events',
} as const;

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
  /** Transmitters allowed to observe this session's presence, and whose presence it may observe. */
  peers: Set<string>;
  /** Beacons this transmitter belongs to; scopes voice-state visibility. */
  beaconIds: Set<string>;
}

/**
 * Relationship lookups the gateway needs. The default implementation reads Postgres;
 * tests may inject a stub. Every method must fail closed (empty / null) on error.
 */
export interface GatewayResolver {
  getPresencePeers(transmitterId: string): Promise<string[]>;
  getBeaconIds(transmitterId: string): Promise<string[]>;
  /** Returns the relay's beacon id when the transmitter may join its voice room. */
  authorizeVoice(transmitterId: string, relayId: string): Promise<string | null>;
}

export function createDatabaseResolver(databaseUrl = process.env.DATABASE_URL): GatewayResolver {
  if (!databaseUrl) {
    console.warn('[Gateway] DATABASE_URL not set: relationship scoping will deny all cross-user events');
    return {
      getPresencePeers: async () => [],
      getBeaconIds: async () => [],
      authorizeVoice: async () => null,
    };
  }
  const { db } = createDatabaseClient(databaseUrl);
  const safe = <T>(fn: () => Promise<T>, fallback: T) =>
    fn().catch((err) => {
      console.warn('[Gateway] Resolver query failed:', err?.message);
      return fallback;
    });
  return {
    getPresencePeers: (id) => safe(() => resolvePresencePeers(db, id), []),
    getBeaconIds: (id) => safe(() => resolveTransmitterBeaconIds(db, id), []),
    authorizeVoice: (id, relayId) => safe(() => authorizeVoiceRelay(db, id, relayId), null),
  };
}

interface VoiceState {
  transmitterId: string;
  username: string;
  relayId: string;
  beaconId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
}

export interface GatewayOptions {
  resolver?: GatewayResolver;
  /** Disable Redis entirely (single-instance / tests). */
  redis?: boolean;
}

const maskPresence = (p: PresenceState): PresenceState =>
  p === PRESENCE_STATES.INVISIBLE ? PRESENCE_STATES.OFFLINE : p;

export function createGatewayServer(customPort = port, options: GatewayOptions = {}) {
  const instanceId = randomUUID();
  const resolver = options.resolver ?? createDatabaseResolver();
  const wss = new WebSocketServer({ port: customPort });
  const sessions = new Map<WebSocket, Session>();
  const voiceStates = new Map<string, VoiceState>();
  /** Last known presence (already masked) for every transmitter seen on the cluster. */
  const knownPresence = new Map<string, PresenceState>();

  let redisPub: Redis | null = null;
  let redisSub: Redis | null = null;
  const redisReady = () => !!redisPub && (redisPub as any).status === 'ready';

  const send = (ws: WebSocket, payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };
  const dispatch = (ws: WebSocket, t: string, d: unknown) =>
    send(ws, { op: GATEWAY_OPCODES.DISPATCH, t, d });

  const authedSessions = function* () {
    for (const [ws, sess] of sessions) {
      if (sess.isAuthenticated && sess.transmitterId) yield [ws, sess] as const;
    }
  };

  // ---- Local delivery (each event is applied exactly once per instance) ----

  function deliverPresence(event: { transmitter_id: string; presence: PresenceState }) {
    knownPresence.set(event.transmitter_id, event.presence);
    for (const [ws, sess] of authedSessions()) {
      if (sess.transmitterId !== event.transmitter_id && sess.peers.has(event.transmitter_id)) {
        dispatch(ws, 'PRESENCE_UPDATE', event);
      }
    }
  }

  function deliverVoice(event: {
    transmitter_id: string;
    username: string;
    relay_id: string | null;
    beacon_id: string | null;
    is_muted: boolean;
    is_deafened: boolean;
    is_speaking: boolean;
  }) {
    const previous = voiceStates.get(event.transmitter_id);
    if (event.relay_id && event.beacon_id) {
      voiceStates.set(event.transmitter_id, {
        transmitterId: event.transmitter_id,
        username: event.username,
        relayId: event.relay_id,
        beaconId: event.beacon_id,
        isMuted: event.is_muted,
        isDeafened: event.is_deafened,
        isSpeaking: event.is_speaking,
      });
    } else {
      voiceStates.delete(event.transmitter_id);
    }
    // Leaving a room must reach members of the beacon that room belonged to.
    const beaconId = event.beacon_id ?? previous?.beaconId;
    if (!beaconId) return;
    const payload = { ...event, beacon_id: beaconId };
    for (const [ws, sess] of authedSessions()) {
      if (sess.beaconIds.has(beaconId)) dispatch(ws, 'VOICE_STATE_UPDATE', payload);
    }
  }

  function deliverDispatch(event: { type: string; audience?: string[] }) {
    if (!Array.isArray(event.audience) || event.audience.length === 0) return; // fail closed
    const audience = new Set(event.audience);
    const { audience: _omit, ...payload } = event;
    for (const [ws, sess] of authedSessions()) {
      if (audience.has(sess.transmitterId!)) dispatch(ws, event.type, payload);
    }
  }

  // ---- Snapshots scoped to a session ----

  function presenceSnapshot(sess: Session) {
    return [...sess.peers]
      .filter((id) => knownPresence.has(id))
      .map((id) => ({ transmitter_id: id, presence: knownPresence.get(id)! }));
  }

  function voiceSnapshot(sess: Session) {
    return [...voiceStates.values()].filter((v) => sess.beaconIds.has(v.beaconId));
  }

  async function loadRelationships(sess: Session) {
    const [peers, beaconIds] = await Promise.all([
      resolver.getPresencePeers(sess.transmitterId!),
      resolver.getBeaconIds(sess.transmitterId!),
    ]);
    sess.peers = new Set(peers);
    sess.beaconIds = new Set(beaconIds);
  }

  async function refreshSessions(transmitterIds: string[]) {
    const targets = new Set(transmitterIds);
    for (const [ws, sess] of authedSessions()) {
      if (!targets.has(sess.transmitterId!)) continue;
      await loadRelationships(sess);
      dispatch(ws, 'RELATIONSHIPS_REFRESH', {
        presences: presenceSnapshot(sess),
        voice_states: voiceSnapshot(sess),
      });
    }
  }

  // ---- Publishing (local delivery first, Redis for other instances) ----

  function publish(channel: string, event: Record<string, unknown>) {
    if (redisReady()) {
      redisPub!.publish(channel, JSON.stringify({ ...event, origin: instanceId })).catch(() => {});
    }
  }

  function broadcastPresenceUpdate(transmitterId: string, presence: PresenceState) {
    const event = {
      transmitter_id: transmitterId,
      presence: maskPresence(presence), // Ghost Mode: peers never observe 'invisible'
      timestamp: new Date().toISOString(),
    };
    deliverPresence(event);
    publish(CHANNELS.presence, event);
  }

  function broadcastVoiceStateUpdate(
    sess: Session,
    relayId: string | null,
    beaconId: string | null
  ) {
    const event = {
      transmitter_id: sess.transmitterId!,
      username: sess.username || 'Transmitter',
      relay_id: relayId,
      beacon_id: beaconId,
      is_muted: !!sess.isMuted,
      is_deafened: !!sess.isDeafened,
      is_speaking: !!sess.isSpeaking,
      timestamp: new Date().toISOString(),
    };
    deliverVoice(event);
    publish(CHANNELS.voice, event);
  }

  // ---- Redis wiring ----

  if (options.redis !== false) {
    try {
      redisPub = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      redisSub = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      redisPub.on('error', () => {});
      redisSub.on('error', () => {});

      redisPub.connect().catch((err: any) => {
        console.warn('[Gateway] Redis Pub connection delayed:', err.message);
      });

      redisSub
        .connect()
        .then(() => {
          redisSub?.subscribe(...Object.values(CHANNELS), (err) => {
            if (err) console.warn('[Gateway] Redis Sub subscription error:', err);
          });
          redisSub?.on('message', (channel, message) => {
            let event: any;
            try {
              event = JSON.parse(message);
            } catch {
              return;
            }
            // Events we published were already delivered locally.
            if (event.origin === instanceId) return;
            if (channel === CHANNELS.presence) deliverPresence(event);
            else if (channel === CHANNELS.voice) deliverVoice(event);
            else if (channel === CHANNELS.dispatch) deliverDispatch(event);
            else if (channel === CHANNELS.session && Array.isArray(event.transmitter_ids)) {
              refreshSessions(event.transmitter_ids).catch(() => {});
            }
          });
        })
        .catch((err: any) => {
          console.warn('[Gateway] Redis Sub connection delayed:', err.message);
        });
    } catch (err) {
      console.warn('[Gateway] Redis setup warning:', err);
    }
  }

  // ---- Connection lifecycle ----

  wss.on('connection', (ws: WebSocket) => {
    sessions.set(ws, {
      presence: PRESENCE_STATES.ONLINE,
      isAuthenticated: false,
      isAlive: true,
      peers: new Set(),
      beaconIds: new Set(),
    });

    send(ws, { op: GATEWAY_OPCODES.HELLO, d: { heartbeat_interval: 30000 } });

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

    ws.on('message', async (data: string) => {
      let payload: any;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        return;
      }
      const session = sessions.get(ws);
      if (!session) return;

      if (payload.op === GATEWAY_OPCODES.HEARTBEAT) {
        session.isAlive = true;
        send(ws, { op: GATEWAY_OPCODES.HEARTBEAT_ACK });
        return;
      }

      if (payload.op === GATEWAY_OPCODES.IDENTIFY) {
        if (session.isAuthenticated) return; // ignore repeat IDENTIFY
        const token = payload.d?.token;
        if (!token || typeof token !== 'string') {
          ws.close(4002, 'Malformed IDENTIFY payload');
          return;
        }
        const decoded = verifyToken<TokenPayload>(token, JWT_SECRET);
        if (!decoded) {
          ws.close(4003, 'Invalid or expired authentication ticket');
          return;
        }

        clearTimeout(authTimeout);
        session.transmitterId = decoded.transmitterId;
        session.username = decoded.username;
        const requested = payload.d?.presence as PresenceState;
        session.presence = Object.values(PRESENCE_STATES).includes(requested)
          ? requested
          : PRESENCE_STATES.ONLINE;

        await loadRelationships(session);
        session.isAuthenticated = true;

        dispatch(ws, 'READY', {
          transmitter: { id: session.transmitterId, username: session.username },
          presence: session.presence,
          presences: presenceSnapshot(session),
          voice_states: voiceSnapshot(session),
          session_id: `subspace_sess_${randomUUID()}`,
        });

        broadcastPresenceUpdate(session.transmitterId, session.presence);
        return;
      }

      if (!session.isAuthenticated) {
        ws.close(4004, 'Unauthenticated operation');
        return;
      }

      if (payload.op === GATEWAY_OPCODES.VOICE_STATE_UPDATE) {
        const { relay_id, is_muted, is_deafened, is_speaking } = payload.d || {};
        let beaconId: string | null = null;
        if (relay_id) {
          if (typeof relay_id !== 'string') return;
          beaconId = await resolver.authorizeVoice(session.transmitterId!, relay_id);
          if (!beaconId) {
            dispatch(ws, 'VOICE_STATE_REJECTED', { relay_id, reason: 'FORBIDDEN' });
            return;
          }
        }
        session.voiceRelayId = relay_id || null;
        session.isMuted = !!is_muted;
        session.isDeafened = !!is_deafened;
        session.isSpeaking = !!is_speaking;
        broadcastVoiceStateUpdate(session, session.voiceRelayId ?? null, beaconId);
        return;
      }

      if (payload.op === GATEWAY_OPCODES.PRESENCE_UPDATE) {
        const requestedPresence = payload.d?.presence as PresenceState;
        if (!Object.values(PRESENCE_STATES).includes(requestedPresence)) return;
        session.presence = requestedPresence;
        dispatch(ws, 'PRESENCE_CONFIRMATION', { presence: requestedPresence });
        broadcastPresenceUpdate(session.transmitterId!, requestedPresence);
      }
    });

    ws.on('close', () => {
      const session = sessions.get(ws);
      sessions.delete(ws);
      clearTimeout(authTimeout);
      if (!session?.transmitterId || !session.isAuthenticated) return;

      if (session.voiceRelayId) {
        session.isMuted = session.isDeafened = session.isSpeaking = false;
        broadcastVoiceStateUpdate(session, null, null);
      }
      // Only go offline when this was the transmitter's last session on this instance.
      const stillConnected = [...sessions.values()].some(
        (s) => s.isAuthenticated && s.transmitterId === session.transmitterId
      );
      if (!stillConnected) broadcastPresenceUpdate(session.transmitterId, PRESENCE_STATES.OFFLINE);
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const session = sessions.get(ws);
      if (session && !session.isAlive) {
        ws.terminate();
        return;
      }
      if (session) session.isAlive = false;
      ws.ping();
    });
  }, 30000);

  const close = async () => {
    clearInterval(interval);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    for (const r of [redisPub, redisSub]) {
      if (!r) continue;
      try {
        await r.quit();
      } catch {
        r.disconnect();
      }
    }
  };

  console.log(`[Gateway Service] Subspace Gateway listening on port ${customPort}`);
  return { wss, sessions, close, refreshSessions, deliverDispatch };
}

if (process.env.NODE_ENV !== 'test') {
  createGatewayServer();
}
