import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { GATEWAY_OPCODES, PRESENCE_STATES, PresenceState } from '@subspace/constants';
import { verifyAccessToken, TokenPayload, getJwtSecret } from '@subspace/crypto';
import {
  createDatabaseClient,
  resolvePresencePeers,
  resolveTransmitterBeaconIds,
  authorizeVoiceRelay,
  authorizeCall,
  transmissions,
  eq,
  and,
  statsKey,
} from '@subspace/database';
import { Redis } from 'ioredis';

// Package-local .env first, then the repo-root .env (native runs); existing env always wins.
dotenv.config({ path: ['.env', '../../.env'] });

const port = Number(process.env.GATEWAY_PORT) || 3002;
const host = process.env.GATEWAY_HOST || '0.0.0.0';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const JWT_SECRET = getJwtSecret();

const CHANNELS = {
  presence: 'gateway:presence:events',
  voice: 'gateway:voice:events',
  dispatch: 'gateway:transmission:events',
  session: 'gateway:session:events',
} as const;

/** Redis hash mirroring every session's masked presence, so the API can read it (e.g. member lists). */
const PRESENCE_HASH_KEY = 'presence';

export interface Session {
  transmitterId?: string;
  username?: string;
  /** Device session id from the access token; revoking it closes this socket. */
  sid?: string;
  presence: PresenceState;
  isAuthenticated: boolean;
  isAlive: boolean;
  voiceRelayId?: string | null;
  /** Direct-link or mesh call this session is connected to, with everyone in that conversation. */
  voiceCall?: { type: string; id: string; audience: string[] } | null;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
  /** When this session joined voice (ms), for the voice-time badges. */
  voiceSince?: number | null;
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
  /** Everyone in the conversation when the transmitter may join its call, otherwise null. */
  authorizeCall(transmitterId: string, channelType: string, channelId: string): Promise<string[] | null>;
  /** Record how a call ended on its "started a call" transmission. */
  finishCall(messageId: string, content: string): Promise<void>;
}

export function createDatabaseResolver(databaseUrl = process.env.DATABASE_URL): GatewayResolver {
  if (!databaseUrl) {
    console.warn('[Gateway] DATABASE_URL not set: relationship scoping will deny all cross-user events');
    return {
      getPresencePeers: async () => [],
      getBeaconIds: async () => [],
      authorizeVoice: async () => null,
      authorizeCall: async () => null,
      finishCall: async () => {},
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
    authorizeCall: (id, type, channelId) => safe(() => authorizeCall(db, id, type, channelId), null),
    finishCall: (messageId, content) =>
      safe(async () => {
        await db.update(transmissions).set({ content }).where(and(eq(transmissions.id, messageId), eq(transmissions.type, 'system_call')));
      }, undefined),
  };
}

interface VoiceState {
  transmitterId: string;
  username: string;
  relayId: string | null;
  beaconId: string | null;
  callType: string | null;
  callId: string | null;
  /** For calls: the conversation members allowed to see this state. */
  audience: string[];
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
}

export interface GatewayOptions {
  resolver?: GatewayResolver;
  /** Disable Redis entirely (single-instance / tests). */
  redis?: boolean;
  /** Where time spent in voice goes (default: the transmitter's Redis stats, for badges). */
  recordVoiceMinutes?: (transmitterId: string, minutes: number) => void;
}

const maskPresence = (p: PresenceState): PresenceState =>
  p === PRESENCE_STATES.INVISIBLE ? PRESENCE_STATES.OFFLINE : p;

export function createGatewayServer(customPort = port, options: GatewayOptions = {}) {
  const instanceId = randomUUID();
  const resolver = options.resolver ?? createDatabaseResolver();
  const wss = new WebSocketServer({ port: customPort, host });
  const sessions = new Map<WebSocket, Session>();
  const voiceStates = new Map<string, VoiceState>();
  /** Last known presence (already masked) for every transmitter seen on the cluster. */
  const knownPresence = new Map<string, PresenceState>();

  let redisPub: Redis | null = null;

  /** Starts or stops this session's voice clock; stopping adds the time to the transmitter's stats. */
  const trackVoiceTime = (session: Session, inVoice: boolean) => {
    if (inVoice) {
      session.voiceSince ??= Date.now();
      return;
    }
    if (!session.voiceSince || !session.transmitterId) return;
    const minutes = (Date.now() - session.voiceSince) / 60_000;
    session.voiceSince = null;
    if (minutes <= 0) return;
    if (options.recordVoiceMinutes) options.recordVoiceMinutes(session.transmitterId, minutes);
    else void redisPub?.hincrbyfloat(statsKey(session.transmitterId), 'voiceMinutes', minutes).catch(() => {});
  };
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

  type VoiceEvent = {
    transmitter_id: string;
    username: string;
    relay_id: string | null;
    beacon_id: string | null;
    call_type?: string | null;
    call_id?: string | null;
    call_participants?: string[];
    is_muted: boolean;
    is_deafened: boolean;
    is_speaking: boolean;
  };

  /** Who may see a voice state: the relay's beacon members, or the call's conversation members. */
  const sendVoiceTo = (scope: { beaconId: string | null; audience: string[] }, payload: unknown) => {
    const audience = new Set(scope.audience);
    for (const [ws, sess] of authedSessions()) {
      const sees = scope.beaconId ? sess.beaconIds.has(scope.beaconId) : audience.has(sess.transmitterId!);
      if (sees) dispatch(ws, 'VOICE_STATE_UPDATE', payload);
    }
  };

  function deliverVoice(event: VoiceEvent) {
    const previous = voiceStates.get(event.transmitter_id);
    const inRelay = !!(event.relay_id && event.beacon_id);
    const inCall = !inRelay && !!(event.call_id && event.call_type);
    const next: VoiceState | null =
      inRelay || inCall
        ? {
            transmitterId: event.transmitter_id,
            username: event.username,
            relayId: inRelay ? event.relay_id : null,
            beaconId: inRelay ? event.beacon_id : null,
            callType: inCall ? event.call_type! : null,
            callId: inCall ? event.call_id! : null,
            audience: inCall ? event.call_participants ?? [] : [],
            isMuted: event.is_muted,
            isDeafened: event.is_deafened,
            isSpeaking: event.is_speaking,
          }
        : null;
    if (next) voiceStates.set(event.transmitter_id, next);
    else voiceStates.delete(event.transmitter_id);

    // Leaving a room must reach whoever could see that room, and nobody else learns where
    // the transmitter went next.
    const sameRoom = previous && next && previous.relayId === next.relayId && previous.callId === next.callId;
    if (previous && !sameRoom) {
      sendVoiceTo(previous, { ...event, relay_id: null, call_id: null, call_type: null, call_participants: undefined, beacon_id: previous.beaconId });
    }
    if (next) sendVoiceTo(next, { ...event, call_participants: undefined });
  }

  /** Whether anyone (on any instance) is still connected to a call. */
  const callOccupied = (type: string, id: string) => [...voiceStates.values()].some((v) => v.callType === type && v.callId === id);

  /**
   * The last person left a call: close the record, note the duration and who joined on the
   * "started a call" transmission, and tell the conversation. Redis DEL picks one instance.
   */
  async function endCall(type: string, id: string) {
    if (!redisReady()) return;
    const key = `call:${type}:${id}`;
    const raw = await redisPub!.get(key).catch(() => null);
    if (!raw || (await redisPub!.del(key).catch(() => 0)) !== 1) return;
    const joined = await redisPub!.smembers(`${key}:joined`).catch(() => [] as string[]);
    await redisPub!.del(`${key}:joined`).catch(() => {});
    const call = JSON.parse(raw) as { messageId: string; startedAt: string; participants: string[] };
    const content = JSON.stringify({ startedAt: call.startedAt, endedAt: new Date().toISOString(), joined });
    await resolver.finishCall(call.messageId, content);
    for (const event of [
      { type: 'TRANSMISSION_UPDATE', channelType: type, channelId: id, transmission: { id: call.messageId, content, type: 'system_call' } },
      { type: 'CALL_DELETE', channelType: type, channelId: id },
    ]) {
      const withAudience = { ...event, audience: call.participants };
      deliverDispatch(withAudience);
      publish(CHANNELS.dispatch, withAudience);
    }
  }

  function deliverDispatch(event: { type: string; audience?: string[]; voice_relay_id?: string; sender_id?: string }) {
    if (!Array.isArray(event.audience) || event.audience.length === 0) return; // fail closed
    let audience = new Set(event.audience);
    // Voice-room events (the soundboard) reach only people in that comm-link, and only when the
    // sender is in it too: voice presence lives here, not in the API.
    if (event.voice_relay_id) {
      if (voiceStates.get(event.sender_id ?? '')?.relayId !== event.voice_relay_id) return;
      audience = new Set([...audience].filter((id) => voiceStates.get(id)?.relayId === event.voice_relay_id));
    }
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
    // Same snake_case shape as VOICE_STATE_UPDATE events.
    return [...voiceStates.values()]
      .filter((v) => (v.beaconId ? sess.beaconIds.has(v.beaconId) : v.audience.includes(sess.transmitterId!)))
      .map((v) => ({
        transmitter_id: v.transmitterId,
        username: v.username,
        relay_id: v.relayId,
        beacon_id: v.beaconId,
        call_type: v.callType,
        call_id: v.callId,
        is_muted: v.isMuted,
        is_deafened: v.isDeafened,
        is_speaking: v.isSpeaking,
      }));
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

  /** A device was signed out (or the account disabled/deleted): tell its sockets, then close them. */
  function revokeSockets(event: { transmitter_id?: string; session_ids?: string[]; all?: boolean; keep?: string | null }) {
    const ids = new Set(event.session_ids ?? []);
    for (const [ws, sess] of authedSessions()) {
      if (sess.transmitterId !== event.transmitter_id) continue;
      const hit = event.all ? sess.sid !== event.keep || !sess.sid : !!sess.sid && ids.has(sess.sid);
      if (!hit) continue;
      dispatch(ws, 'SESSION_REVOKED', {});
      ws.close(4005, 'Session signed out');
    }
  }

  // ---- Publishing (local delivery first, Redis for other instances) ----

  function publish(channel: string, event: Record<string, unknown>) {
    if (redisReady()) {
      redisPub!.publish(channel, JSON.stringify({ ...event, origin: instanceId })).catch(() => {});
    }
  }

  function broadcastPresenceUpdate(transmitterId: string, presence: PresenceState, isDisconnect = false) {
    const masked = maskPresence(presence); // Ghost Mode: peers never observe 'invisible'
    const event = {
      transmitter_id: transmitterId,
      presence: masked,
      timestamp: new Date().toISOString(),
    };
    deliverPresence(event);
    publish(CHANNELS.presence, event);
    if (redisReady()) {
      if (isDisconnect) redisPub!.hdel(PRESENCE_HASH_KEY, transmitterId).catch(() => {});
      else redisPub!.hset(PRESENCE_HASH_KEY, transmitterId, masked).catch(() => {});
    }
  }

  function broadcastVoiceStateUpdate(
    sess: Session,
    relayId: string | null,
    beaconId: string | null
  ) {
    const call = relayId ? null : sess.voiceCall ?? null;
    const previous = voiceStates.get(sess.transmitterId!);
    const event = {
      transmitter_id: sess.transmitterId!,
      username: sess.username || 'Transmitter',
      relay_id: relayId,
      beacon_id: beaconId,
      call_type: call?.type ?? null,
      call_id: call?.id ?? null,
      call_participants: call?.audience,
      is_muted: !!sess.isMuted,
      is_deafened: !!sess.isDeafened,
      is_speaking: !!sess.isSpeaking,
      timestamp: new Date().toISOString(),
    };
    deliverVoice(event);
    publish(CHANNELS.voice, event);
    // Left a call (hung up, switched rooms, or the socket closed): end it if that emptied it.
    if (previous?.callType && previous.callId && !(call && call.id === previous.callId) && !callOccupied(previous.callType, previous.callId)) {
      endCall(previous.callType, previous.callId).catch((err) => console.warn('[Gateway] Ending call failed:', err?.message));
    }
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
            else if (channel === CHANNELS.session && event.type === 'SESSION_REVOKE') revokeSockets(event);
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
        const decoded = verifyAccessToken(token, JWT_SECRET);
        if (!decoded) {
          ws.close(4003, 'Invalid or expired authentication ticket');
          return;
        }

        clearTimeout(authTimeout);
        session.transmitterId = decoded.transmitterId;
        session.username = decoded.username;
        session.sid = decoded.sid;
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
        const { relay_id, call_type, call_id, is_muted, is_deafened, is_speaking } = payload.d || {};
        let beaconId: string | null = null;
        let call: Session['voiceCall'] = null;
        if (relay_id) {
          if (typeof relay_id !== 'string') return;
          beaconId = await resolver.authorizeVoice(session.transmitterId!, relay_id);
          if (!beaconId) {
            dispatch(ws, 'VOICE_STATE_REJECTED', { relay_id, reason: 'FORBIDDEN' });
            return;
          }
        } else if (call_id) {
          if (typeof call_id !== 'string' || (call_type !== 'link' && call_type !== 'mesh')) return;
          const audience = await resolver.authorizeCall(session.transmitterId!, call_type, call_id);
          if (!audience) {
            dispatch(ws, 'VOICE_STATE_REJECTED', { call_id, reason: 'FORBIDDEN' });
            return;
          }
          call = { type: call_type, id: call_id, audience };
        }
        session.voiceCall = call;
        session.voiceRelayId = relay_id || null;
        session.isMuted = !!is_muted;
        session.isDeafened = !!is_deafened;
        session.isSpeaking = !!is_speaking;
        trackVoiceTime(session, !!(session.voiceRelayId || session.voiceCall));
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

      trackVoiceTime(session, false);
      if (session.voiceRelayId || session.voiceCall) {
        session.isMuted = session.isDeafened = session.isSpeaking = false;
        session.voiceCall = null;
        broadcastVoiceStateUpdate(session, null, null);
      }
      // Only go offline when this was the transmitter's last session on this instance.
      const stillConnected = [...sessions.values()].some(
        (s) => s.isAuthenticated && s.transmitterId === session.transmitterId
      );
      if (!stillConnected) broadcastPresenceUpdate(session.transmitterId, PRESENCE_STATES.OFFLINE, true);
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
