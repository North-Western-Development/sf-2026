// Routes gateway DISPATCH events into the store.
import { gateway } from '../services/gateway';
import {
  toBeacon,
  toCall,
  toClearance,
  toEditPatch,
  toMember,
  toMesh,
  toRelay,
  toTransmission,
  toUserRef,
  resolveName,
} from '../lib/normalize';
import { channelKey, type ChannelKey, type ChannelType, type NotificationSetting, type Presence, type VoiceState } from '../lib/types';
import {
  getState,
  rememberUsers,
  removeMessage,
  setPresence,
  setState,
  setTyping,
  upsertMessages,
  patchMessage,
  stashEmbeds,
} from './store';
import { openEncrypted } from './e2ee';
import { openSignal } from '../lib/e2ee/client';
import { onRoomKeySignal } from '../features/voice/roomKeys';
import { loadSounds, onSoundboardPlay, useSounds } from '../features/voice/soundboard';
import { onActivityEventMessage, onActivityUpdate } from '../features/voice/activities';
import { invalidateStickers } from '../features/chat/ExpressionPanels';
import { bumpThread, upsertThread, type ThreadSummary } from '../features/chat/threads';
import { ackChannel, applyReaction, loadBeacon, loadCalls, loadMessages, refreshBeacons, syncReadStates, loadTransmissionRequests, refreshLinks, refreshRelationships, signOut } from './actions';
import { maybeNotify, mentionsMe, playPing } from './notifications';
import { removeEvent, upsertEvent } from './community';
import { toast } from '../app/ui';

type Raw = Record<string, any>;

/** Channel a transmission event belongs to (contract fields first, legacy fallbacks). */
function eventChannel(d: Raw): ChannelKey | null {
  if (d.channelType && d.channelId) return channelKey(d.channelType as ChannelType, d.channelId);
  const t = d.transmission ?? {};
  if (d.thread_id || t.threadId) return channelKey('thread', d.thread_id ?? t.threadId);
  if (d.relay_id || t.relayId) return channelKey('relay', d.relay_id ?? t.relayId);
  if (d.mesh_id || t.meshId) return channelKey('mesh', d.mesh_id ?? t.meshId);
  if (d.link_id || t.p2pLinkId) return channelKey('link', d.link_id ?? t.p2pLinkId);
  return null;
}

let navigate: (path: string) => void = () => {};
export const setBridgeNavigator = (fn: (path: string) => void) => {
  navigate = fn;
};

function pathFor(key: ChannelKey): string {
  const [type, id] = key.split(':') as [ChannelType, string];
  if (type === 'relay') {
    const relay = getState().relays[id];
    return relay ? `/channels/${relay.beaconId}/${id}` : '/channels/@me';
  }
  if (type === 'link' || type === 'mesh') return `/channels/@me/${id}`;
  return '/channels/@me';
}

function titleFor(key: ChannelKey, authorName: string): string {
  const [type, id] = key.split(':') as [ChannelType, string];
  const s = getState();
  if (type === 'relay') {
    const relay = s.relays[id];
    const beacon = relay ? s.beacons[relay.beaconId] : undefined;
    return relay && beacon ? `${authorName} (#${relay.name}, ${beacon.name})` : authorName;
  }
  if (type === 'mesh') return `${authorName} (${s.meshes[id]?.name ?? 'Subspace Mesh'})`;
  return authorName;
}

/** A gateway voice state: in a Comm-Link relay, in a direct-link or mesh call, or null (left). */
function toVoiceState(v: Raw): VoiceState | null {
  const callKey = v.call_id && (v.call_type === 'link' || v.call_type === 'mesh') ? channelKey(v.call_type, v.call_id) : null;
  if (!v.relay_id && !callKey) return null;
  return {
    transmitterId: v.transmitter_id,
    username: v.username,
    relayId: v.relay_id ?? null,
    beaconId: v.beacon_id ?? null,
    callKey,
    isMuted: !!v.is_muted,
    isDeafened: !!v.is_deafened,
    isSpeaking: !!v.is_speaking,
  };
}


function onThread(d: Raw) {
  const t = d.thread as ThreadSummary | undefined;
  if (!t || !('messageCount' in t)) return;
  upsertThread(t);
  if (t.starterTransmissionId) patchMessage(channelKey('relay', t.relayId), t.starterTransmissionId, { thread: t });
}

function onTransmissionCreate(d: Raw) {
  const key = eventChannel(d);
  if (!key || !d.transmission) return;
  const t = { ...toTransmission(d.transmission), nonce: d.nonce ?? d.transmission.nonce };
  if (d.channelType === 'thread') bumpThread(d.channelId, t.createdAt);
  rememberUsers([t.author]);
  const s = getState();
  const me = s.me;

  // First message on a DM this client has not seen: load it, so its list entry (and a click on
  // the notification) can open it.
  const linkLoad = key.startsWith('link:') && !s.links[key.slice(5)] ? refreshLinks().catch(() => {}) : null;

  if (s.messages[key]?.loaded) {
    upsertMessages(key, [t]);
    openEncrypted(key, [t]);
  }
  else
    setState((st) => ({
      activity: { ...st.activity, [key]: { ...st.activity[key], lastId: t.id, lastAt: t.createdAt } },
    }));

  // Clear their typing indicator.
  setTyping(key, t.author.id, null);

  if (!me || t.author.id === me.id) {
    void ackChannel(key);
    return;
  }

  const viewing = s.activeChannel === key && document.visibilityState === 'visible';
  if (viewing) {
    void ackChannel(key);
  } else if (mentionsMe(s, key, t)) {
    setState((st) => {
      const cur = st.readStates[key] ?? { lastReadId: null, lastReadAt: null, mentionCount: 0 };
      return { readStates: { ...st.readStates, [key]: { ...cur, mentionCount: cur.mentionCount + 1 } } };
    });
  }

  const relay = key.startsWith('relay:') ? s.relays[key.slice(6)] : undefined;
  const member = relay ? s.members[relay.beaconId]?.[t.author.id] : undefined;
  // Calls ring through the incoming-call prompt instead of a message notification.
  if (t.type !== 'system_call') maybeNotify(key, t.encrypted ? { ...t, content: 'Sent an encrypted transmission' } : t, titleFor(key, resolveName(t.author, member)), () => void Promise.resolve(linkLoad).then(() => navigate(pathFor(key))));
}

const handlers: Record<string, (d: Raw) => void> = {
  EVENT_UPSERT(d) {
    const prev = upsertEvent(d.event);
    // Interested people hear when it starts.
    if (prev?.meInterested && prev.status === 'scheduled' && d.event.status === 'active') toast(`${d.event.name} is starting now`, 'success');
  },
  EVENT_DELETE(d) {
    removeEvent(d.beaconId, d.eventId);
  },
  READY(d) {
    handlers.RELATIONSHIPS_REFRESH(d);
    // Catch up on anything sent between the REST load (or a dropped connection) and this READY.
    void syncReadStates().catch(() => {});
    void refreshRelationships().catch(() => {});
    void refreshBeacons().catch(() => {});
    void loadCalls().catch(() => {});
    const { messages, relayIdsByBeacon } = getState();
    for (const beaconId of Object.keys(relayIdsByBeacon)) void loadBeacon(beaconId).catch(() => {});
    for (const key of Object.keys(messages) as ChannelKey[]) if (messages[key].loaded) void loadMessages(key);
  },
  RELATIONSHIPS_REFRESH(d) {
    // READY can beat the REST load that fills in `me`, so prefer the id the gateway sends.
    const meId = d.transmitter?.id ?? getState().me?.id;
    // Snapshots carry status only; keep custom statuses already received (or set by me since boot).
    if (meId && d.presence) setPresence(meId, { status: d.presence });
    for (const p of d.presences ?? []) setPresence(p.transmitter_id, { status: p.presence, ...(p.custom_status !== undefined ? { customStatus: p.custom_status } : {}) });
    handlers.VOICE_STATES_REPLACE(d);
  },
  VOICE_STATES_REPLACE(d) {
    const voice: Record<string, VoiceState> = {};
    for (const v of d.voice_states ?? []) {
      const state = toVoiceState(v);
      if (state) voice[v.transmitter_id] = state;
    }
    setState({ voice });
  },
  PRESENCE_UPDATE(d) {
    setPresence(d.transmitter_id, {
      status: d.presence as Presence,
      ...(d.custom_status !== undefined ? { customStatus: d.custom_status } : {}),
    });
  },
  PRESENCE_CONFIRMATION(d) {
    const me = getState().me;
    if (me) setPresence(me.id, { status: d.presence });
  },
  VOICE_STATE_UPDATE(d) {
    setState((s) => {
      const voice = { ...s.voice };
      const state = toVoiceState(d);
      if (state) voice[d.transmitter_id] = state;
      else delete voice[d.transmitter_id];
      return { voice };
    });
  },
  CALL_CREATE(d) {
    const key = eventChannel(d);
    if (key) setState((s) => ({ calls: { ...s.calls, [key]: toCall(d) } }));
  },
  CALL_UPDATE(d) {
    handlers.CALL_CREATE(d);
  },
  CALL_DELETE(d) {
    const key = eventChannel(d);
    if (!key) return;
    setState((s) => {
      const calls = { ...s.calls };
      delete calls[key];
      return { calls };
    });
  },

  TRANSMISSION_CREATE: onTransmissionCreate,
  DIRECT_TRANSMISSION_CREATE: onTransmissionCreate,
  MESH_TRANSMISSION_CREATE: onTransmissionCreate,
  TRANSMISSION_UPDATE(d) {
    const key = eventChannel(d);
    if (!key || !d.transmission) return;
    if (getState().messages[key]?.byId[d.transmission.id]) patchMessage(key, d.transmission.id, toEditPatch(d.transmission));
    else upsertMessages(key, [toTransmission(d.transmission)]);
    const updated = getState().messages[key]?.byId[d.transmission.id];
    if (updated) openEncrypted(key, [updated]);
  },
  TRANSMISSION_EMBEDS_UPDATE(d) {
    const key = eventChannel(d);
    if (!key) return;
    if (getState().messages[key]?.byId[d.transmissionId]) patchMessage(key, d.transmissionId, { embeds: d.embeds ?? [], suppressEmbeds: !d.embeds?.length });
    else stashEmbeds(d.transmissionId, d.embeds ?? []);
  },
  TRANSMISSION_DELETE(d) {
    const key = eventChannel(d);
    if (key) removeMessage(key, d.transmissionId ?? d.transmission_id);
  },
  REACTION_ADD(d) {
    const key = eventChannel(d);
    if (key && d.userId !== getState().me?.id) applyReaction(key, d.transmissionId, d.emoji, d.userId, true);
  },
  REACTION_REMOVE(d) {
    const key = eventChannel(d);
    if (key && d.userId !== getState().me?.id) applyReaction(key, d.transmissionId, d.emoji, d.userId, false);
  },
  TYPING_START(d) {
    const key = eventChannel(d);
    if (key && d.userId !== getState().me?.id) setTyping(key, d.userId, Date.now() + 10_000);
  },
  READ_STATE_UPDATE(d) {
    const key = eventChannel(d);
    if (!key) return;
    setState((s) => ({
      readStates: {
        ...s.readStates,
        [key]: { lastReadId: d.lastReadId ?? null, lastReadAt: d.lastReadAt ?? null, mentionCount: d.mentionCount ?? 0 },
      },
    }));
  },
  CHANNEL_PINS_UPDATE() {
    /* pins panel refetches on open */
  },
  NOTIFICATION_SETTINGS_UPDATE(d) {
    setState((s) => ({ notificationSettings: { ...s.notificationSettings, [`${d.scopeType}:${d.scopeId}`]: d as NotificationSetting } }));
  },

  BEACON_CREATE(d) {
    const b = toBeacon(d.beacon ?? d);
    setState((s) => ({
      beacons: { ...s.beacons, [b.id]: b },
      beaconOrder: s.beaconOrder.includes(b.id) ? s.beaconOrder : [...s.beaconOrder, b.id],
    }));
  },
  // Text-relay threads (forum posts carry no starterTransmissionId and are handled by the forum view).
  THREAD_CREATE(d) {
    onThread(d);
  },
  THREAD_UPDATE(d) {
    onThread(d);
  },
  BEACON_EXPRESSIONS_UPDATE(d) {
    if (d.kind === 'stickers') invalidateStickers();
    else if (d.kind === 'sounds' && useSounds.getState()[d.beaconId]) void loadSounds(d.beaconId, true);
  },
  SOUNDBOARD_PLAY(d) {
    onSoundboardPlay(d as any);
  },
  ACTIVITY_UPDATE(d) {
    onActivityUpdate(d as any);
  },
  ACTIVITY_EVENT(d) {
    onActivityEventMessage(d as any);
  },
  BEACON_UPDATE(d) {
    const b = toBeacon(d.beacon ?? d);
    setState((s) => ({ beacons: { ...s.beacons, [b.id]: { ...s.beacons[b.id], ...b } } }));
  },
  BEACON_DELETE(d) {
    const id = d.id ?? d.beaconId;
    setState((s) => {
      const beacons = { ...s.beacons };
      delete beacons[id];
      return { beacons, beaconOrder: s.beaconOrder.filter((x) => x !== id) };
    });
  },
  RELAY_CREATE(d) {
    const r = toRelay(d.relay ?? d);
    setState((s) => ({
      relays: { ...s.relays, [r.id]: r },
      relayIdsByBeacon: { ...s.relayIdsByBeacon, [r.beaconId]: [...(s.relayIdsByBeacon[r.beaconId] ?? []).filter((x) => x !== r.id), r.id] },
    }));
  },
  RELAY_UPDATE(d) {
    const r = toRelay(d.relay ?? d);
    // Permission changes can alter visibility; reload the beacon's relay list.
    if (getState().relayIdsByBeacon[r.beaconId]) void loadBeacon(r.beaconId).catch(() => {});
  },
  RELAY_DELETE(d) {
    const id = d.id ?? d.relayId;
    setState((s) => {
      const relay = s.relays[id];
      if (!relay) return {};
      const relays = { ...s.relays };
      delete relays[id];
      return {
        relays,
        relayIdsByBeacon: { ...s.relayIdsByBeacon, [relay.beaconId]: (s.relayIdsByBeacon[relay.beaconId] ?? []).filter((x) => x !== id) },
      };
    });
  },
  CLEARANCE_CREATE(d) {
    handlers.CLEARANCE_UPDATE(d);
  },
  CLEARANCE_UPDATE(d) {
    const c = toClearance(d.clearance ?? d);
    setState((s) => ({
      clearances: { ...s.clearances, [c.beaconId]: [...(s.clearances[c.beaconId] ?? []).filter((x) => x.id !== c.id), c] },
    }));
  },
  CLEARANCE_DELETE(d) {
    const beaconId = d.beaconId;
    const id = d.id ?? d.clearanceId;
    setState((s) => ({ clearances: { ...s.clearances, [beaconId]: (s.clearances[beaconId] ?? []).filter((x) => x.id !== id) } }));
  },
  MEMBER_ADD(d) {
    handlers.MEMBER_UPDATE(d);
  },
  MEMBER_UPDATE(d) {
    const beaconId = d.beaconId;
    if (!beaconId || !getState().members[beaconId]) return;
    const raw = d.member ?? d;
    const id = raw.transmitterId ?? raw.user?.id;
    const prev = getState().members[beaconId]?.[id];
    // Older payloads may be partial (no profile): merge instead of replacing.
    const hasProfile = !!(raw.user?.username ?? raw.username);
    const m = hasProfile ? toMember(raw, beaconId) : prev ? { ...prev, ...raw, user: prev.user } : null;
    if (!m) {
      void loadBeacon(beaconId).catch(() => {});
      return;
    }
    rememberUsers([m.user]);
    if (raw.presence) setPresence(m.transmitterId, { status: raw.presence, customStatus: raw.customStatus ?? null });
    setState((s) => ({ members: { ...s.members, [beaconId]: { ...s.members[beaconId], [m.transmitterId]: m } } }));
  },
  MEMBER_REMOVE(d) {
    const beaconId = d.beaconId;
    const userId = d.userId ?? d.transmitterId;
    if (userId === getState().me?.id) {
      handlers.BEACON_DELETE({ id: beaconId });
      return;
    }
    setState((s) => {
      const list = { ...(s.members[beaconId] ?? {}) };
      delete list[userId];
      return { members: { ...s.members, [beaconId]: list } };
    });
  },
  USER_UPDATE(d) {
    const u = toUserRef(d.user ?? d);
    rememberUsers([u]);
    const me = getState().me;
    if (me && u.id === me.id) setState({ me: { ...me, ...(d.user ?? d) } });
  },
  LINK_ENCRYPTION_ENABLED(d) {
    const link = getState().links[d.linkId];
    if (link) setState((s) => ({ links: { ...s.links, [d.linkId]: { ...link, encryptedAt: d.encryptedAt } } }));
  },
  E2EE_SIGNAL(d) {
    const me = getState().me;
    if (!me) return;
    void openSignal(me.id, d as Parameters<typeof openSignal>[1]).then((sig) => {
      if (sig?.topic && (sig.topic.startsWith('relay:') || sig.topic.startsWith('call:'))) void onRoomKeySignal({ ...sig, topic: sig.topic });
    });
  },
  EMAIL_VERIFIED() {
    const me = getState().me;
    if (me) setState({ me: { ...me, isEmailVerified: true } });
  },
  /** This device was signed out from another one (Devices settings, password change, account removal). */
  SESSION_REVOKED() {
    void signOut();
  },
  RELATIONSHIP_ADD(d) {
    void refreshRelationships().catch(() => {});
    const a = d.affiliation;
    if (a?.status === 'pending' && a.targetId === getState().me?.id) playPing();
  },
  RELATIONSHIP_REMOVE() {
    void refreshRelationships().catch(() => {});
  },
  TRANSMISSION_REQUEST_CREATE(d) {
    if (d.recipient_id === getState().me?.id) {
      void loadTransmissionRequests().catch(() => {});
      // Requests flagged as spam arrive quietly, into the Spam tab.
      if (!d.request?.isSpam) playPing();
    }
  },
  MESH_CREATE(d) {
    const m = toMesh(d.mesh ?? d);
    rememberUsers(m.members);
    setState((s) => ({ meshes: { ...s.meshes, [m.id]: m } }));
  },
  MESH_UPDATE(d) {
    handlers.MESH_CREATE(d);
  },
  MESH_DELETE(d) {
    const id = d.id ?? d.meshId;
    setState((s) => {
      const meshes = { ...s.meshes };
      delete meshes[id];
      return { meshes };
    });
  },
};

let started = false;
let typingSweep: ReturnType<typeof setInterval> | null = null;

/** Connect the gateway and start routing events. Idempotent. */
export function startBridge(): () => void {
  if (started) return () => {};
  started = true;
  const offDispatch = gateway.onDispatch((type, data) => {
    try {
      handlers[type]?.(data ?? {});
    } catch (err) {
      console.warn(`[bridge] ${type} handler failed`, err);
    }
  });
  const offStatus = gateway.onStatus((gatewayStatus) => setState({ gatewayStatus }));
  // Expire typing indicators.
  typingSweep = setInterval(() => {
    const now = Date.now();
    const { typing } = getState();
    let changed = false;
    const next: typeof typing = {};
    for (const [key, users] of Object.entries(typing) as Array<[ChannelKey, Record<string, number>]>) {
      const live = Object.fromEntries(Object.entries(users).filter(([, exp]) => exp > now));
      if (Object.keys(live).length !== Object.keys(users).length) changed = true;
      next[key] = live;
    }
    if (changed) setState({ typing: next });
  }, 1000);

  let saved: string | null = null;
  try {
    saved = localStorage.getItem('subspace_presence');
  } catch {
    /* ignore */
  }
  if (saved) gateway.updatePresence(saved);
  gateway.connect();

  // Re-ack the visible channel when the window regains focus.
  const onFocus = () => {
    const key = getState().activeChannel;
    if (key) void ackChannel(key);
  };
  window.addEventListener('focus', onFocus);

  return () => {
    started = false;
    offDispatch();
    offStatus();
    if (typingSweep) clearInterval(typingSweep);
    window.removeEventListener('focus', onFocus);
    gateway.disconnect();
  };
}

export { patchMessage };
