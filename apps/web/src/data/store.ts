import { create } from 'zustand';
import type { Activity } from '@subspace/constants';
import type {
  Beacon,
  CallInfo,
  ChannelActivity,
  ChannelKey,
  Clearance,
  Cluster,
  CustomStatus,
  DirectLink,
  Member,
  Mesh,
  NotificationSetting,
  Presence,
  ReadState,
  Relationship,
  Relay,
  SelfUser,
  Transmission,
  TransmissionRequest,
  UserRef,
  VoiceState,
} from '../lib/types';

export interface ChannelMessages {
  ids: string[];
  byId: Record<string, Transmission>;
  hasMoreBefore: boolean;
  loading: boolean;
  loaded: boolean;
  error?: string;
}

export interface PresenceEntry {
  status: Presence;
  customStatus?: CustomStatus | null;
  /** What they are playing, when their Activity Privacy lets me see it. */
  activity?: Activity | null;
}

export interface SubspaceState {
  me: SelfUser | null;
  ready: boolean;

  beacons: Record<string, Beacon>;
  beaconOrder: string[];
  clusters: Cluster[];
  relays: Record<string, Relay>;
  relayIdsByBeacon: Record<string, string[]>;
  clearances: Record<string, Clearance[]>;
  members: Record<string, Record<string, Member>>;
  users: Record<string, UserRef>;
  presence: Record<string, PresenceEntry>;

  links: Record<string, DirectLink>;
  meshes: Record<string, Mesh>;
  relationships: Record<string, Relationship>;
  transmissionRequests: Record<string, TransmissionRequest>;

  messages: Record<ChannelKey, ChannelMessages>;
  readStates: Record<ChannelKey, ReadState>;
  activity: Record<ChannelKey, ChannelActivity>;
  notificationSettings: Record<string, NotificationSetting>;
  /** channelKey -> userId -> expiry epoch ms */
  typing: Record<ChannelKey, Record<string, number>>;
  voice: Record<string, VoiceState>;
  /** Active direct-link and mesh calls. */
  calls: Record<ChannelKey, CallInfo>;
  gatewayStatus: 'connecting' | 'ready' | 'reconnecting' | 'offline';
  /** Channel currently on screen (drives auto-ack and notification suppression). */
  activeChannel: ChannelKey | null;
}

const initial: SubspaceState = {
  me: null,
  ready: false,
  beacons: {},
  beaconOrder: [],
  clusters: [],
  relays: {},
  relayIdsByBeacon: {},
  clearances: {},
  members: {},
  users: {},
  presence: {},
  links: {},
  meshes: {},
  relationships: {},
  transmissionRequests: {},
  messages: {},
  readStates: {},
  activity: {},
  notificationSettings: {},
  typing: {},
  voice: {},
  calls: {},
  gatewayStatus: 'connecting',
  activeChannel: null,
};

export const useStore = create<SubspaceState>()(() => ({ ...initial }));

export const resetStore = () => useStore.setState({ ...initial }, true);

// ---------------------------------------------------------------------------
// Pure update helpers (used by actions and the gateway bridge)
// ---------------------------------------------------------------------------

const set = useStore.setState;
const get = useStore.getState;

export const emptyChannel = (): ChannelMessages => ({
  ids: [],
  byId: {},
  hasMoreBefore: true,
  loading: false,
  loaded: false,
});

const byTime = (a: Transmission, b: Transmission) =>
  a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1;

/** Previews that arrived before their transmission (e.g. while the sender's request is in flight). */
const earlyEmbeds = new Map<string, { embeds: Transmission['embeds']; at: number }>();
export function stashEmbeds(id: string, embeds: Transmission['embeds']) {
  const now = Date.now();
  for (const [k, v] of earlyEmbeds) if (now - v.at > 60_000) earlyEmbeds.delete(k);
  earlyEmbeds.set(id, { embeds, at: now });
}

export function upsertMessages(key: ChannelKey, incoming: Transmission[], opts: Partial<ChannelMessages> = {}) {
  set((s) => {
    const ch = s.messages[key] ?? emptyChannel();
    const byId = { ...ch.byId };
    for (const t of incoming) {
      // Reconcile an optimistic message by nonce.
      if (t.nonce) {
        const pendingId = ch.ids.find((id) => byId[id]?.nonce === t.nonce && byId[id]?.pending);
        if (pendingId && pendingId !== t.id) delete byId[pendingId];
      }
      const prev = byId[t.id];
      // Previews arrive by event and can beat a slower copy of the same transmission (the
      // sender's own HTTP response); an empty list only wins when previews were removed.
      const early = earlyEmbeds.get(t.id)?.embeds;
      earlyEmbeds.delete(t.id);
      const embeds = early ?? (prev?.embeds?.length && !t.embeds?.length && !t.suppressEmbeds && prev.content === t.content ? prev.embeds : t.embeds);
      // Already-decrypted text survives a refetch of the same (unedited) ciphertext.
      const opened = t.e2ee === 'pending' && prev?.e2ee === 'ok' && prev.editedAt === t.editedAt ? { content: prev.content, encryptedAttachments: prev.encryptedAttachments, e2ee: prev.e2ee } : {};
      byId[t.id] = { ...prev, ...t, embeds, ...opened, pending: false, failed: false };
    }
    const ids = Object.values(byId).sort(byTime).map((t) => t.id);
    // Ephemeral answers live on this device only; they are never the channel's latest.
    const latestId = [...ids].reverse().find((id) => !byId[id].ephemeral);
    const latest = latestId ? byId[latestId] : null;
    const activity = latest && !latest.pending
      ? {
          ...s.activity,
          [key]: {
            ...s.activity[key],
            lastId: latest.id,
            lastAt:
              s.activity[key]?.lastAt && s.activity[key]!.lastAt! > latest.createdAt
                ? s.activity[key]!.lastAt
                : latest.createdAt,
          },
        }
      : s.activity;
    return { messages: { ...s.messages, [key]: { ...ch, ...opts, ids, byId } }, activity };
  });
}

export function patchMessage(key: ChannelKey, id: string, patch: Partial<Transmission> | ((t: Transmission) => Partial<Transmission>)) {
  set((s) => {
    const ch = s.messages[key];
    const cur = ch?.byId[id];
    if (!ch || !cur) return {};
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
    return { messages: { ...s.messages, [key]: { ...ch, byId: { ...ch.byId, [id]: next } } } };
  });
}

export function removeMessage(key: ChannelKey, id: string) {
  set((s) => {
    const ch = s.messages[key];
    if (!ch?.byId[id]) return {};
    const byId = { ...ch.byId };
    delete byId[id];
    return { messages: { ...s.messages, [key]: { ...ch, byId, ids: ch.ids.filter((x) => x !== id) } } };
  });
}

export function setChannelMeta(key: ChannelKey, meta: Partial<ChannelMessages>) {
  set((s) => ({ messages: { ...s.messages, [key]: { ...(s.messages[key] ?? emptyChannel()), ...meta } } }));
}

export function rememberUsers(users: UserRef[]) {
  if (!users.length) return;
  set((s) => {
    const next = { ...s.users };
    for (const u of users) if (u?.id) next[u.id] = { ...next[u.id], ...u };
    return { users: next };
  });
}

export function setPresence(id: string, entry: Partial<PresenceEntry>) {
  set((s) => ({ presence: { ...s.presence, [id]: { ...(s.presence[id] ?? { status: 'offline' as Presence }), ...entry } } }));
}

export function setTyping(key: ChannelKey, userId: string, expiresAt: number | null) {
  set((s) => {
    const cur = { ...(s.typing[key] ?? {}) };
    if (expiresAt) cur[userId] = expiresAt;
    else delete cur[userId];
    return { typing: { ...s.typing, [key]: cur } };
  });
}

export const selectors = {
  beaconRelays: (beaconId: string) => (s: SubspaceState) =>
    (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter(Boolean),
  member: (beaconId: string | undefined, userId: string) => (s: SubspaceState) =>
    beaconId ? s.members[beaconId]?.[userId] : undefined,
};

export { get as getState, set as setState };
