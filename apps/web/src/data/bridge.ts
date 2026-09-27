// Routes gateway DISPATCH events into the store.
import { gateway } from '../services/gateway';
import {
  toBeacon,
  toClearance,
  toMember,
  toMesh,
  toRelay,
  toTransmission,
  toUserRef,
  resolveName,
} from '../lib/normalize';
import { channelKey, type ChannelKey, type ChannelType, type NotificationSetting, type Presence } from '../lib/types';
import {
  getState,
  rememberUsers,
  removeMessage,
  setPresence,
  setState,
  setTyping,
  upsertMessages,
  patchMessage,
} from './store';
import { ackChannel, applyReaction, loadBeacon, refreshRelationships } from './actions';
import { maybeNotify, mentionsMe } from './notifications';

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

function onTransmissionCreate(d: Raw) {
  const key = eventChannel(d);
  if (!key || !d.transmission) return;
  const t = { ...toTransmission(d.transmission), nonce: d.nonce ?? d.transmission.nonce };
  rememberUsers([t.author]);
  const s = getState();
  const me = s.me;

  // Unknown DM/mesh (first message from someone): refresh lists lazily.
  if (key.startsWith('link:') && !s.links[key.slice(5)]) void import('./actions').then((a) => a.bootstrap()).catch(() => {});

  if (s.messages[key]?.loaded) upsertMessages(key, [t]);
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
  maybeNotify(key, t, titleFor(key, resolveName(t.author, member)), () => navigate(pathFor(key)));
}

const handlers: Record<string, (d: Raw) => void> = {
  READY(d) {
    for (const p of d.presences ?? []) setPresence(p.transmitter_id, { status: p.presence, customStatus: p.custom_status });
    handlers.VOICE_STATES_REPLACE(d);
  },
  RELATIONSHIPS_REFRESH(d) {
    handlers.READY(d);
  },
  VOICE_STATES_REPLACE(d) {
    const voice: Record<string, any> = {};
    for (const v of d.voice_states ?? []) {
      voice[v.transmitter_id] = {
        transmitterId: v.transmitter_id,
        username: v.username,
        relayId: v.relay_id,
        beaconId: v.beacon_id,
        isMuted: !!v.is_muted,
        isDeafened: !!v.is_deafened,
        isSpeaking: !!v.is_speaking,
      };
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
      if (d.relay_id) {
        voice[d.transmitter_id] = {
          transmitterId: d.transmitter_id,
          username: d.username,
          relayId: d.relay_id,
          beaconId: d.beacon_id,
          isMuted: !!d.is_muted,
          isDeafened: !!d.is_deafened,
          isSpeaking: !!d.is_speaking,
        };
      } else delete voice[d.transmitter_id];
      return { voice };
    });
  },

  TRANSMISSION_CREATE: onTransmissionCreate,
  DIRECT_TRANSMISSION_CREATE: onTransmissionCreate,
  MESH_TRANSMISSION_CREATE: onTransmissionCreate,
  TRANSMISSION_UPDATE(d) {
    const key = eventChannel(d);
    if (key && d.transmission) upsertMessages(key, [toTransmission(d.transmission)]);
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
    const m = toMember(d.member ?? d, beaconId);
    rememberUsers([m.user]);
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
  RELATIONSHIP_ADD() {
    void refreshRelationships().catch(() => {});
  },
  RELATIONSHIP_REMOVE() {
    void refreshRelationships().catch(() => {});
  },
  TRANSMISSION_REQUEST_CREATE() {
    void refreshRelationships().catch(() => {});
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
