import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import {
  GATEWAY_OPCODES,
  PRESENCE_STATES,
  PresenceState,
  PERMISSIONS,
  hasPermission,
  ACTIVITY_VISIBILITY,
  sanitizeActivity,
  sameActivity,
  type Activity,
  type ActivityVisibility,
} from '@subspace/constants';
import { verifyAccessToken, TokenPayload, getJwtSecret } from '@subspace/crypto';
import {
  createDatabaseClient,
  resolvePresencePeers,
  resolveFriendIds,
  resolveBotIntents,
  resolveTransmitterBeaconIds,
  authorizeVoiceRelay,
  computeRelayPermissions,
  appBots,
  transmitters,
  authorizeCall,
  transmissions,
  eq,
  and,
  statsKey,
  regionBlocked,
  loadRegionRanges,
  REGION_BLOCKED_HEADERS,
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
  activity: 'gateway:activity:events',
} as const;

/** Activity updates a session may share: one every ACTIVITY_INTERVAL_MS, the latest kept for the next slot. */
const ACTIVITY_INTERVAL_MS = 2000;

/** Redis hash mirroring every session's masked presence, so the API can read it (e.g. member lists). */
const PRESENCE_HASH_KEY = 'presence';
/** Redis hash: transmitter id -> the comm-link (relay id) they are connected to. */
const VOICE_HASH_KEY = 'voice:relay';

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
  isClipping?: boolean;
  isPriority?: boolean;
  /** When this session joined voice (ms), for the voice-time badges. */
  voiceSince?: number | null;
  /** Transmitters allowed to observe this session's presence, and whose presence it may observe. */
  peers: Set<string>;
  /** Beacons this transmitter belongs to; scopes voice-state visibility. */
  beaconIds: Set<string>;
  /** Accepted affiliates: who sees an activity shared with friends only. */
  friends: Set<string>;
  /** Activity Privacy from their account, reloaded on RELATIONSHIPS_REFRESH. */
  activityVisibility: ActivityVisibility;
  /** What this session reports they are doing (desktop app), kept only while connected. */
  activity: Activity | null;
  activityAt?: number;
  activityTimer?: ReturnType<typeof setTimeout> | null;
  /** A bot's connection, and the privileged intents it has (its developer's choice, within the instance's developer policy). */
  isBot?: boolean;
  messageContent?: boolean;
  activityIntent?: boolean;
  /** When this session last changed its presence (op 3), for the rate limit. */
  presenceTimes?: number[];
}

/**
 * Relationship lookups the gateway needs. The default implementation reads Postgres;
 * tests may inject a stub. Every method must fail closed (empty / null) on error.
 */
export interface GatewayResolver {
  getPresencePeers(transmitterId: string): Promise<string[]>;
  getBeaconIds(transmitterId: string): Promise<string[]>;
  /** Accepted affiliates (defaults to none). */
  getFriendIds?(transmitterId: string): Promise<string[]>;
  /** Their Activity Privacy setting (defaults to 'off'). */
  getActivityVisibility?(transmitterId: string): Promise<ActivityVisibility>;
  /** Returns the relay's beacon id when the transmitter may join its voice room. */
  authorizeVoice(transmitterId: string, relayId: string): Promise<string | null>;
  /** Whether they hold Priority Speaker in that comm-link. */
  canPrioritySpeak(transmitterId: string, relayId: string): Promise<boolean>;
  /** Everyone in the conversation when the transmitter may join its call, otherwise null. */
  authorizeCall(transmitterId: string, channelType: string, channelId: string): Promise<string[] | null>;
  /** Record how a call ended on its "started a call" transmission. */
  finishCall(messageId: string, content: string): Promise<void>;
  /** The bot behind a bot token (`Bot <token>` in IDENTIFY) and the intents it gets, or null. */
  resolveBot(token: string): Promise<{ transmitterId: string; username: string; messageContent: boolean; activity: boolean } | null>;
  /** A connected bot's intents again, after its developer or the developer policy changed (defaults to unchanged). */
  getBotIntents?(botUserId: string): Promise<{ messageContent: boolean; activity: boolean }>;
}

export function createDatabaseResolver(databaseUrl = process.env.DATABASE_URL): GatewayResolver {
  if (!databaseUrl) {
    console.warn('[Gateway] DATABASE_URL not set: relationship scoping will deny all cross-user events');
    return {
      getPresencePeers: async () => [],
      getBeaconIds: async () => [],
      authorizeVoice: async () => null,
      canPrioritySpeak: async () => false,
      authorizeCall: async () => null,
      finishCall: async () => {},
      resolveBot: async () => null,
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
    getFriendIds: (id) => safe(() => resolveFriendIds(db, id), []),
    getActivityVisibility: (id) =>
      safe(async () => {
        const [row] = await db.select({ v: transmitters.activityVisibility }).from(transmitters).where(eq(transmitters.id, id)).limit(1);
        return (ACTIVITY_VISIBILITY as readonly string[]).includes(row?.v ?? '') ? (row!.v as ActivityVisibility) : 'off';
      }, 'off' as ActivityVisibility),
    authorizeVoice: (id, relayId) => safe(() => authorizeVoiceRelay(db, id, relayId), null),
    canPrioritySpeak: (id, relayId) => safe(async () => hasPermission(await computeRelayPermissions(db, id, relayId), PERMISSIONS.PRIORITY_SPEAKER), false),
    authorizeCall: (id, type, channelId) => safe(() => authorizeCall(db, id, type, channelId), null),
    resolveBot: (token) =>
      safe(async () => {
        const hash = createHash('sha256').update(token).digest('hex');
        const [row] = await db
          .select({ transmitterId: appBots.userId, username: transmitters.username })
          .from(appBots)
          .innerJoin(transmitters, eq(transmitters.id, appBots.userId))
          .where(eq(appBots.tokenHash, hash))
          .limit(1);
        return row ? { ...row, ...(await resolveBotIntents(db, row.transmitterId)) } : null;
      }, null),
    getBotIntents: (id) => safe(() => resolveBotIntents(db, id), { messageContent: false, activity: false }),
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
  isClipping: boolean;
  isPriority: boolean;
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
  // Clients send small JSON frames; anything bigger is refused before it is buffered.
  loadRegionRanges();
  const wss = new WebSocketServer({
    port: customPort,
    host,
    maxPayload: 16 * 1024,
    // BLOCK_EU: nobody in the EU, the EEA or the UK connects. Behind nginx on the same host the
    // client address is in X-Forwarded-For (set by nginx, never passed through from the client).
    verifyClient: (info, done) => {
      const remote = info.req.socket.remoteAddress ?? '';
      const forwarded = String(info.req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      const ip = forwarded && /^(127\.|::1$|::ffff:127\.)/.test(remote) ? forwarded : remote;
      if (regionBlocked(ip)) done(false, 401, 'Subspace Frequency is not available in your region', { ...REGION_BLOCKED_HEADERS });
      else done(true);
    },
  });
  const sessions = new Map<WebSocket, Session>();
  const voiceStates = new Map<string, VoiceState>();
  /** Last known presence (already masked) for every transmitter seen on the cluster. */
  const knownPresence = new Map<string, PresenceState>();
  /** Shared activities on the cluster, and who may see each ('friends' or every presence peer). */
  const knownActivity = new Map<string, { activity: Activity; audience: 'everyone' | 'friends' }>();

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

  type ActivityEvent = { transmitter_id: string; activity: Activity | null; audience: 'everyone' | 'friends' };

  /** Whether this session may see that transmitter's shared activity. Their own other devices always do. */
  const seesActivity = (sess: Session, transmitterId: string, audience: 'everyone' | 'friends') =>
    sess.transmitterId === transmitterId ||
    ((!sess.isBot || !!sess.activityIntent) && sess.peers.has(transmitterId) && (audience === 'everyone' || sess.friends.has(transmitterId)));

  function deliverActivity(event: ActivityEvent) {
    const previous = knownActivity.get(event.transmitter_id);
    if (event.activity) knownActivity.set(event.transmitter_id, { activity: event.activity, audience: event.audience });
    else knownActivity.delete(event.transmitter_id);
    for (const [ws, sess] of authedSessions()) {
      if (event.activity && seesActivity(sess, event.transmitter_id, event.audience)) {
        dispatch(ws, 'USER_ACTIVITY_UPDATE', { transmitter_id: event.transmitter_id, activity: event.activity });
      } else if (previous && seesActivity(sess, event.transmitter_id, previous.audience)) {
        // Cleared, or narrowed to friends: whoever saw it before stops seeing it.
        dispatch(ws, 'USER_ACTIVITY_UPDATE', { transmitter_id: event.transmitter_id, activity: null });
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
    is_clipping?: boolean;
    is_priority?: boolean;
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
            isClipping: !!event.is_clipping,
            isPriority: !!event.is_priority,
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

  /**
   * What a bot sees of an event: without the Message Content intent, message text, embeds and
   * attachments only where it is mentioned or wrote the message itself (Discord's rule).
   */
  /**
   * What a bot without the Message Content intent may see of a transmission event: everything
   * about it but what was said, unless it mentions the bot, is the bot's own, or is in a Direct
   * Link or mesh with it (Discord exempts DMs too). Replies' snippets, forwarded text and link
   * previews arriving later are what was said as well.
   */
  function forBot(sess: Session, payload: any) {
    if (sess.messageContent || !payload || typeof payload !== 'object') return payload;
    const inDm = (p: any) => p?.channelType === 'link' || p?.channelType === 'mesh' || !!p?.p2pLinkId || !!p?.meshId;
    // Link previews filled in after sending (TRANSMISSION_EMBEDS_UPDATE).
    if (Array.isArray(payload.embeds) && payload.transmissionId && !payload.transmission) {
      return inDm(payload) ? payload : { ...payload, embeds: [] };
    }
    const t = payload.transmission;
    if (!t || typeof t !== 'object') return payload;
    const mentioned = Array.isArray(t.mentions) && t.mentions.includes(sess.transmitterId);
    const own = t.author?.id === sess.transmitterId || t.transmitterId === sess.transmitterId;
    if (mentioned || own || inDm(payload) || inDm(t)) return payload;
    return {
      ...payload,
      transmission: {
        ...t,
        content: '',
        embeds: [],
        attachments: [],
        stickers: [],
        poll: null,
        ...(t.forwarded ? { forwarded: { ...t.forwarded, content: '', attachments: [], stickers: [] } } : {}),
        ...(t.replyTo && typeof t.replyTo === 'object' ? { replyTo: { ...t.replyTo, content: '' } } : {}),
      },
    };
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
    const { audience: _omit, payloadType, ...rest } = event as typeof event & { payloadType?: unknown };
    // The payload's own `type` (an interaction's 2), which the event name had to make room for.
    const payload = payloadType !== undefined ? { ...rest, type: payloadType } : rest;
    for (const [ws, sess] of authedSessions()) {
      if (audience.has(sess.transmitterId!)) dispatch(ws, event.type, sess.isBot ? forBot(sess, payload) : payload);
    }
  }

  // ---- Snapshots scoped to a session ----

  function presenceSnapshot(sess: Session) {
    return [...sess.peers]
      .filter((id) => knownPresence.has(id))
      .map((id) => ({ transmitter_id: id, presence: knownPresence.get(id)! }));
  }

  function activitySnapshot(sess: Session) {
    return [...knownActivity]
      .filter(([id, entry]) => seesActivity(sess, id, entry.audience))
      .map(([id, entry]) => ({ transmitter_id: id, activity: entry.activity }));
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
        is_clipping: v.isClipping,
        is_priority: v.isPriority,
      }));
  }

  async function loadRelationships(sess: Session) {
    const [peers, beaconIds, friends, visibility] = await Promise.all([
      resolver.getPresencePeers(sess.transmitterId!),
      resolver.getBeaconIds(sess.transmitterId!),
      resolver.getFriendIds?.(sess.transmitterId!) ?? Promise.resolve([]),
      // Bots have no privacy settings: what they are "playing" is for everyone.
      sess.isBot ? Promise.resolve('everyone' as const) : (resolver.getActivityVisibility?.(sess.transmitterId!) ?? Promise.resolve('off' as const)),
    ]);
    sess.peers = new Set(peers);
    sess.beaconIds = new Set(beaconIds);
    sess.friends = new Set(friends);
    sess.activityVisibility = visibility;
    if (sess.isBot && resolver.getBotIntents) {
      const intents = await resolver.getBotIntents(sess.transmitterId!);
      sess.messageContent = intents.messageContent;
      sess.activityIntent = intents.activity;
    }
  }

  async function refreshSessions(transmitterIds: string[]) {
    const targets = new Set(transmitterIds);
    for (const [ws, sess] of authedSessions()) {
      if (!targets.has(sess.transmitterId!)) continue;
      const before = sess.activityVisibility;
      await loadRelationships(sess);
      dispatch(ws, 'RELATIONSHIPS_REFRESH', {
        presences: presenceSnapshot(sess),
        voice_states: voiceSnapshot(sess),
        activities: activitySnapshot(sess),
      });
      // Activity Privacy changed: share again under the new setting (or stop sharing).
      if (sess.activity && before !== sess.activityVisibility) shareActivity(sess);
    }
  }

  /**
   * Share what this session reports, as their Activity Privacy allows: nothing when it is off or
   * they are invisible. The newest report across their sessions wins; it is never written anywhere.
   */
  function shareActivity(sess: Session) {
    const visibility = sess.activityVisibility;
    const hidden = visibility === 'off' || sess.presence === PRESENCE_STATES.INVISIBLE;
    const activity = hidden ? null : sess.activity;
    const audience = visibility === 'friends' ? 'friends' : 'everyone';
    const known = knownActivity.get(sess.transmitterId!);
    if (!activity && !known) return;
    if (activity && known && known.audience === audience && sameActivity(known.activity, activity)) return;
    const event: ActivityEvent = { transmitter_id: sess.transmitterId!, activity, audience };
    deliverActivity(event);
    publish(CHANNELS.activity, event);
  }

  /**
   * At most one shared update per ACTIVITY_INTERVAL_MS per session; the last one always goes out.
   * Stopping is never held back.
   */
  function scheduleActivity(sess: Session) {
    if (!sess.activity && sess.activityTimer) {
      clearTimeout(sess.activityTimer);
      sess.activityTimer = null;
    }
    if (sess.activityTimer) return;
    const wait = Math.max(0, (sess.activityAt ?? 0) + ACTIVITY_INTERVAL_MS - Date.now());
    const run = () => {
      sess.activityTimer = null;
      sess.activityAt = Date.now();
      shareActivity(sess);
    };
    if (wait === 0 || !sess.activity) run();
    else sess.activityTimer = setTimeout(run, wait);
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
      is_clipping: !!sess.isClipping,
      is_priority: !!sess.isPriority,
      timestamp: new Date().toISOString(),
    };
    // Which comm-link or stage each transmitter is in, for the API (activities and stages check
    // it). Sent before the broadcast, so whoever hears they joined can already act on it.
    if (redisReady()) {
      if (relayId) redisPub!.hset(VOICE_HASH_KEY, sess.transmitterId!, relayId).catch(() => {});
      else redisPub!.hdel(VOICE_HASH_KEY, sess.transmitterId!).catch(() => {});
    }
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
            else if (channel === CHANNELS.activity) deliverActivity({ ...event, activity: event.activity ? sanitizeActivity(event.activity) : null });
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
      friends: new Set(),
      activityVisibility: 'off',
      activity: null,
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
        // Bots identify with `Bot <token>`; people with their access token.
        let decoded: { transmitterId: string; username: string; sid?: string } | null;
        if (token.startsWith('Bot ')) {
          const bot = await resolver.resolveBot(token.slice(4).trim());
          decoded = bot ? { transmitterId: bot.transmitterId, username: bot.username } : null;
          session.isBot = !!bot;
          session.messageContent = !!bot?.messageContent;
          session.activityIntent = !!bot?.activity;
        } else {
          decoded = verifyAccessToken(token, JWT_SECRET);
        }
        if (!decoded) {
          ws.close(4003, 'Invalid or expired authentication ticket');
          return;
        }
        // A device signed out (Logged-in Devices, password change) cannot connect on a token it still holds.
        if (decoded.sid && redisReady() && !(await redisPub!.hexists(`sessions:${decoded.transmitterId}`, decoded.sid).catch(() => 1))) {
          ws.close(4003, 'Session has been signed out');
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
          activities: activitySnapshot(session),
          activity_visibility: session.activityVisibility,
          session_id: `subspace_sess_${randomUUID()}`,
        });

        broadcastPresenceUpdate(session.transmitterId, session.presence);
        return;
      }

      if (!session.isAuthenticated) {
        ws.close(4004, 'Unauthenticated operation');
        return;
      }

      // Bots do not join voice.
      if (payload.op === GATEWAY_OPCODES.VOICE_STATE_UPDATE && session.isBot) return;
      if (payload.op === GATEWAY_OPCODES.VOICE_STATE_UPDATE) {
        const { relay_id, call_type, call_id, is_muted, is_deafened, is_speaking, is_clipping, is_priority } = payload.d || {};
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
        session.isClipping = !!is_clipping;
        // Priority Speaker only for those who hold it in this comm-link.
        session.isPriority = !!is_priority && !!relay_id && (await resolver.canPrioritySpeak(session.transmitterId!, relay_id));
        trackVoiceTime(session, !!(session.voiceRelayId || session.voiceCall));
        broadcastVoiceStateUpdate(session, session.voiceRelayId ?? null, beaconId);
        return;
      }

      if (payload.op === GATEWAY_OPCODES.PRESENCE_UPDATE) {
        const requestedPresence = payload.d?.presence as PresenceState;
        if (!Object.values(PRESENCE_STATES).includes(requestedPresence)) return;
        // Each change is broadcast to everyone who sees them: at most 5 every 20 seconds.
        const now = Date.now();
        session.presenceTimes = (session.presenceTimes ?? []).filter((t) => now - t < 20_000);
        if (session.presenceTimes.length >= 5) return;
        session.presenceTimes.push(now);
        const wasInvisible = session.presence === PRESENCE_STATES.INVISIBLE;
        session.presence = requestedPresence;
        dispatch(ws, 'PRESENCE_CONFIRMATION', { presence: requestedPresence });
        broadcastPresenceUpdate(session.transmitterId!, requestedPresence);
        // Going invisible hides the activity too; coming back shares it again.
        if (session.activity && wasInvisible !== (requestedPresence === PRESENCE_STATES.INVISIBLE)) shareActivity(session);
        return;
      }

      if (payload.op === GATEWAY_OPCODES.ACTIVITY_UPDATE) {
        const raw = payload.d?.activity;
        const activity = raw === null ? null : sanitizeActivity(raw);
        if (raw !== null && !activity) return;
        session.activity = activity;
        scheduleActivity(session);
      }
    });

    ws.on('close', () => {
      const session = sessions.get(ws);
      sessions.delete(ws);
      clearTimeout(authTimeout);
      if (!session?.transmitterId || !session.isAuthenticated) return;

      if (session.activityTimer) clearTimeout(session.activityTimer);
      if (session.activity) {
        // Their activity ends with the session that reported it.
        session.activity = null;
        const other = [...sessions.values()].find((s) => s.isAuthenticated && s.transmitterId === session.transmitterId && s.activity);
        shareActivity(other ?? session);
      }
      trackVoiceTime(session, false);
      if (session.voiceRelayId || session.voiceCall) {
        session.isMuted = session.isDeafened = session.isSpeaking = session.isClipping = session.isPriority = false;
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
