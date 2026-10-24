import { http, optional, ApiError } from '../lib/http';
import {
  toBeacon,
  toClearance,
  toCluster,
  toEditPatch,
  toLink,
  toMember,
  toMesh,
  toRelationships,
  toRelay,
  toTransmission,
  toUserRef,
} from '../lib/normalize';
import {
  channelKey,
  parseChannelKey,
  type ChannelKey,
  type ChannelType,
  type NotificationSetting,
  type Presence,
  type SelfUser,
  type Transmission,
} from '../lib/types';
import {
  emptyChannel,
  getState,
  patchMessage,
  rememberUsers,
  removeMessage,
  setChannelMeta,
  setPresence,
  setState,
  upsertMessages,
} from './store';
import { api } from '../services/api';
import { gateway } from '../services/gateway';

type Raw = Record<string, any>;
const PAGE = 50;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function parseReadStates(readRes: Raw) {
  const readStates: Record<string, any> = {};
  for (const r of readRes.readStates ?? []) {
    readStates[channelKey(r.channelType, r.channelId)] = {
      lastReadId: r.lastReadId ?? null,
      lastReadAt: r.lastReadAt ?? null,
      mentionCount: r.mentionCount ?? 0,
    };
  }
  const activity: Record<string, any> = {};
  for (const c of readRes.channels ?? []) {
    activity[channelKey(c.channelType, c.channelId)] = {
      lastId: c.lastTransmissionId ?? null,
      lastAt: c.lastTransmissionAt ?? null,
      beaconId: c.beaconId,
    };
  }
  return { readStates, activity };
}

/** Re-read the joined beacons (names, icons, joins and leaves) after the gateway (re)connects. */
export async function refreshBeacons(): Promise<void> {
  const res = await http.get<{ beacons: Raw[] }>('/beacons/me');
  const beacons = res.beacons.map(toBeacon);
  setState({ beacons: Object.fromEntries(beacons.map((b) => [b.id, b])), beaconOrder: beacons.map((b) => b.id) });
}

let linksLoad: Promise<void> | null = null;
/**
 * Re-read the DM list, e.g. when a first message arrives on a link this client has never seen.
 * Only links change; unread markers received live are kept.
 */
export function refreshLinks(): Promise<void> {
  linksLoad ??= http
    .get<{ links: Raw[] }>('/links')
    .then((res) => {
      const meId = getState().me?.id ?? '';
      const links = res.links.map((l) => toLink(l, meId));
      rememberUsers(links.map((l) => l.recipient));
      setState((s) => {
        const activity = { ...s.activity };
        for (const l of links) activity[channelKey('link', l.id)] ??= { lastId: l.lastTransmissionId, lastAt: l.lastTransmissionAt };
        return { links: Object.fromEntries(links.map((l) => [l.id, l])), activity };
      });
    })
    .finally(() => {
      linksLoad = null;
    });
  return linksLoad;
}

/** Re-read unread markers and mention counts, e.g. after the gateway (re)connects. */
export async function syncReadStates(): Promise<void> {
  const res = await http.get<Raw>('/read-states');
  const fresh = parseReadStates(res);
  const time = (at?: string | null) => (at ? Date.parse(at) : 0);
  setState((s) => {
    const readStates = { ...s.readStates };
    const activity = { ...s.activity };
    for (const key of new Set([...Object.keys(fresh.readStates), ...Object.keys(fresh.activity)]) as Set<ChannelKey>) {
      // A live event newer than this snapshot already updated the channel; the snapshot would undo it.
      if (time(s.activity[key]?.lastAt) > time(fresh.activity[key]?.lastAt)) continue;
      if (fresh.activity[key]) activity[key] = { ...s.activity[key], ...fresh.activity[key] };
      if (fresh.readStates[key]) readStates[key] = fresh.readStates[key];
    }
    return { readStates, activity };
  });
}

export async function bootstrap(): Promise<void> {
  const [meRes, beaconsRes, clustersRes, linksRes, meshesRes, relRes, readRes, notifRes] = await Promise.all([
    http.get<{ transmitter: Raw }>('/auth/me'),
    http.get<{ beacons: Raw[] }>('/beacons/me'),
    optional(http.get<{ clusters: Raw[] }>('/clusters'), { clusters: [] }),
    optional(http.get<{ links: Raw[] }>('/links'), { links: [] }),
    optional(http.get<{ meshes: Raw[] }>('/meshes'), { meshes: [] }),
    optional(http.get<Raw>('/affiliations'), {}),
    optional(http.get<Raw>('/read-states'), { readStates: [], channels: [] }),
    optional(http.get<{ settings: NotificationSetting[] }>('/notification-settings'), { settings: [] }),
  ]);
  void loadTransmissionRequests().catch(() => {});

  const me = { ...toUserRef(meRes.transmitter), ...meRes.transmitter } as SelfUser;
  const beacons = beaconsRes.beacons.map(toBeacon);
  const links = linksRes.links.map((l) => toLink(l, me.id));
  const meshes = meshesRes.meshes.map(toMesh);
  const relationships = toRelationships(relRes, me.id);

  const { readStates, activity } = parseReadStates(readRes);
  for (const l of links) activity[channelKey('link', l.id)] ??= { lastId: l.lastTransmissionId, lastAt: l.lastTransmissionAt };
  for (const m of meshes) activity[channelKey('mesh', m.id)] ??= { lastId: m.lastTransmissionId ?? null, lastAt: m.lastTransmissionAt };

  const notificationSettings: Record<string, NotificationSetting> = {};
  for (const n of notifRes.settings ?? []) notificationSettings[`${n.scopeType}:${n.scopeId}`] = n;

  rememberUsers([me, ...links.map((l) => l.recipient), ...meshes.flatMap((m) => m.members), ...relationships.map((r) => r.user)]);

  setState({
    me,
    beacons: Object.fromEntries(beacons.map((b) => [b.id, b])),
    beaconOrder: beacons.map((b) => b.id),
    clusters: clustersRes.clusters.map(toCluster).sort((a, b) => a.position - b.position),
    links: Object.fromEntries(links.map((l) => [l.id, l])),
    meshes: Object.fromEntries(meshes.map((m) => [m.id, m])),
    relationships: Object.fromEntries(relationships.map((r) => [r.user.id, r])),
    readStates,
    activity,
    notificationSettings,
    ready: true,
  });
}

const beaconLoads = new Map<string, Promise<void>>();

/** Load relays, clearances and members for a beacon; concurrent callers share one request. */
export function loadBeacon(beaconId: string): Promise<void> {
  const inflight = beaconLoads.get(beaconId);
  if (inflight) return inflight;
  const p = fetchBeacon(beaconId).finally(() => beaconLoads.delete(beaconId));
  beaconLoads.set(beaconId, p);
  return p;
}

async function fetchBeacon(beaconId: string): Promise<void> {
  const [relaysRes, clearRes, membersRes] = await Promise.all([
    http.get<{ relays: Raw[] }>(`/beacons/${beaconId}/relays?filter=all`),
    optional(http.get<{ clearances: Raw[] }>(`/beacons/${beaconId}/clearances`), { clearances: [] }),
    optional(http.get<{ members: Raw[] }>(`/beacons/${beaconId}/members`), { members: [] }),
  ]);
  const relays = relaysRes.relays.map(toRelay);
  const members = membersRes.members.map((m) => toMember(m, beaconId));
  rememberUsers(members.map((m) => m.user));
  for (const m of membersRes.members) {
    if (m.presence) setPresence(m.transmitterId ?? m.id, { status: m.presence, customStatus: m.customStatus ?? null });
  }
  setState((s) => ({
    relays: { ...s.relays, ...Object.fromEntries(relays.map((r) => [r.id, r])) },
    relayIdsByBeacon: { ...s.relayIdsByBeacon, [beaconId]: relays.map((r) => r.id) },
    clearances: { ...s.clearances, [beaconId]: clearRes.clearances.map(toClearance) },
    members: { ...s.members, [beaconId]: Object.fromEntries(members.map((m) => [m.transmitterId, m])) },
  }));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Legacy per-container routes, used until the unified /channels routes exist. */
function legacyMessagesPath(type: ChannelType, id: string): string | null {
  if (type === 'relay') return `/relays/${id}/transmissions`;
  if (type === 'link') return `/links/${id}/transmissions`;
  if (type === 'mesh') return `/meshes/${id}/transmissions`;
  return null;
}

async function fetchPage(key: ChannelKey, query: string): Promise<Raw[]> {
  const { type, id } = parseChannelKey(key);
  try {
    const res = await http.get<{ transmissions: Raw[] }>(`/channels/${type}/${id}/transmissions?${query}`);
    return res.transmissions;
  } catch (err) {
    const legacy = legacyMessagesPath(type, id);
    if (!(err instanceof ApiError) || err.status !== 404 || !legacy) throw err;
    const res = await http.get<{ transmissions: Raw[] }>(`${legacy}?${query}`);
    return res.transmissions;
  }
}

export async function loadMessages(key: ChannelKey, opts: { before?: string } = {}): Promise<void> {
  const ch = getState().messages[key] ?? emptyChannel();
  if (ch.loading || (opts.before && !ch.hasMoreBefore)) return;
  setChannelMeta(key, { loading: true, error: undefined });
  try {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (opts.before) q.set('before', opts.before);
    const raw = await fetchPage(key, q.toString());
    const items = raw.map(toTransmission).map((t) => ({ ...t, ...parseChannelFields(key) }));
    rememberUsers(items.map((t) => t.author));
    upsertMessages(key, items, { loading: false, loaded: true, hasMoreBefore: raw.length >= PAGE });
  } catch (err) {
    setChannelMeta(key, { loading: false, error: (err as Error).message });
  }
}

/** Page back through history until `messageId` is loaded (for jumping to search results). */
export async function loadUntil(key: ChannelKey, messageId: string, maxPages = 20): Promise<boolean> {
  let waits = 0;
  for (let i = 0; i <= maxPages; i++) {
    const ch = getState().messages[key];
    if (ch?.byId[messageId]) return true;
    if (ch?.loaded && !ch.hasMoreBefore) return false;
    if (ch?.loading && waits++ < 200) {
      await new Promise((r) => setTimeout(r, 50));
      i--;
      continue;
    }
    const first = ch?.ids.find((id) => !ch.byId[id]?.pending);
    await loadMessages(key, ch?.loaded && first ? { before: first } : {});
  }
  return !!getState().messages[key]?.byId[messageId];
}

const parseChannelFields = (key: ChannelKey) => {
  const { type, id } = parseChannelKey(key);
  return { channelType: type, channelId: id };
};

export interface SendOptions {
  replyToId?: string;
  replyPing?: boolean;
  attachmentIds?: string[];
}

export async function sendMessage(key: ChannelKey, content: string, opts: SendOptions = {}): Promise<void> {
  const me = getState().me;
  if (!me) return;
  const nonce = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const { type, id } = parseChannelKey(key);
  const replyTarget = opts.replyToId ? getState().messages[key]?.byId[opts.replyToId] : undefined;
  const optimistic: Transmission = {
    id: `pending-${nonce}`,
    channelType: type,
    channelId: id,
    author: me,
    content,
    createdAt: new Date().toISOString(),
    editedAt: null,
    attachments: [],
    mentions: [],
    mentionRoles: [],
    mentionEveryone: false,
    replyTo: replyTarget
      ? { id: replyTarget.id, author: replyTarget.author, content: replyTarget.content.slice(0, 200), attachmentsCount: replyTarget.attachments.length, deleted: false }
      : null,
    reactions: [],
    pinned: false,
    type: replyTarget ? 'reply' : 'default',
    pending: true,
    nonce,
  };
  upsertMessages(key, [optimistic]);
  // upsertMessages clears `pending`; re-mark the optimistic entry.
  patchMessage(key, optimistic.id, { pending: true });

  const body = { content, nonce, ...opts };
  try {
    let raw: Raw;
    try {
      raw = (await http.post<{ transmission: Raw }>(`/channels/${type}/${id}/transmissions`, body)).transmission;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
      raw = (await legacySend(key, content)).transmission;
    }
    upsertMessages(key, [{ ...toTransmission(raw), ...parseChannelFields(key), nonce }]);
    await ackChannel(key);
  } catch {
    patchMessage(key, optimistic.id, { pending: false, failed: true });
  }
}

async function legacySend(key: ChannelKey, content: string): Promise<{ transmission: Raw }> {
  const { type, id } = parseChannelKey(key);
  if (type === 'relay') return http.post(`/relays/${id}/transmissions`, { content });
  if (type === 'mesh') return http.post(`/meshes/${id}/transmissions`, { content });
  if (type === 'link') {
    const link = getState().links[id];
    if (!link) throw new Error('Unknown link');
    return http.post(`/links/${link.recipient.id}/transmissions`, { content });
  }
  throw new Error(`Cannot send to ${type} yet`);
}

export async function retryMessage(key: ChannelKey, pendingId: string) {
  const t = getState().messages[key]?.byId[pendingId];
  if (!t) return;
  removeMessage(key, pendingId);
  await sendMessage(key, t.content, { replyToId: t.replyTo?.id });
}

export const editMessage = async (key: ChannelKey, id: string, content: string) => {
  const res = await http.patch<{ transmission: Raw }>(`/transmissions/${id}`, { content });
  patchMessage(key, id, toEditPatch(res.transmission));
};

export const deleteMessage = async (key: ChannelKey, id: string) => {
  await http.delete(`/transmissions/${id}`);
  removeMessage(key, id);
};

export async function toggleReaction(key: ChannelKey, messageId: string, emoji: string) {
  const msg = getState().messages[key]?.byId[messageId];
  if (!msg) return;
  const existing = msg.reactions.find((r) => r.emoji === emoji);
  const adding = !existing?.me;
  applyReaction(key, messageId, emoji, getState().me!.id, adding, true);
  try {
    const path = `/transmissions/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`;
    if (adding) await http.put(path);
    else await http.delete(path);
  } catch {
    applyReaction(key, messageId, emoji, getState().me!.id, !adding, true);
  }
}

/** Shared by optimistic toggles and REACTION_ADD/REMOVE events. */
export function applyReaction(key: ChannelKey, messageId: string, emoji: string, userId: string, add: boolean, isMe = userId === getState().me?.id) {
  patchMessage(key, messageId, (t) => {
    const list = [...t.reactions];
    const i = list.findIndex((r) => r.emoji === emoji);
    if (add) {
      if (i >= 0) {
        if (isMe && list[i].me) return {};
        list[i] = { ...list[i], count: list[i].count + 1, me: list[i].me || isMe };
      } else list.push({ emoji, count: 1, me: isMe });
    } else if (i >= 0) {
      if (isMe && !list[i].me) return {};
      const count = list[i].count - 1;
      if (count <= 0) list.splice(i, 1);
      else list[i] = { ...list[i], count, me: isMe ? false : list[i].me };
    }
    return { reactions: list };
  });
}

export async function setPinned(key: ChannelKey, messageId: string, pinned: boolean) {
  patchMessage(key, messageId, { pinned });
  try {
    if (pinned) await http.put(`/transmissions/${messageId}/pin`);
    else await http.delete(`/transmissions/${messageId}/pin`);
  } catch (err) {
    patchMessage(key, messageId, { pinned: !pinned });
    throw err;
  }
}

export const loadPins = async (key: ChannelKey): Promise<Transmission[]> => {
  const { type, id } = parseChannelKey(key);
  const res = await optional(http.get<{ transmissions: Raw[] }>(`/channels/${type}/${id}/pins`), { transmissions: [] });
  return res.transmissions.map(toTransmission);
};

// ---------------------------------------------------------------------------
// Read state & typing
// ---------------------------------------------------------------------------

const ackTimers = new Map<ChannelKey, ReturnType<typeof setTimeout>>();

/** Mark a channel read up to its newest message (debounced). */
export function ackChannel(key: ChannelKey): Promise<void> {
  const s = getState();
  const act = s.activity[key];
  const ch = s.messages[key];
  const lastId = ch?.ids.filter((i) => !ch.byId[i]?.pending).at(-1) ?? act?.lastId ?? null;
  const lastAt = (lastId && ch?.byId[lastId]?.createdAt) || act?.lastAt || new Date().toISOString();
  const cur = s.readStates[key];
  if (cur && cur.lastReadId === lastId && cur.mentionCount === 0) return Promise.resolve();
  setState((st) => ({ readStates: { ...st.readStates, [key]: { lastReadId: lastId, lastReadAt: lastAt, mentionCount: 0 } } }));
  if (!lastId) return Promise.resolve();
  clearTimeout(ackTimers.get(key));
  return new Promise((resolve) => {
    ackTimers.set(
      key,
      setTimeout(async () => {
        const { type, id } = parseChannelKey(key);
        await optional(http.post(`/channels/${type}/${id}/ack`, { transmissionId: lastId }), undefined).catch(() => {});
        resolve();
      }, 400)
    );
  });
}

export async function ackBeacon(beaconId: string) {
  const s = getState();
  for (const id of s.relayIdsByBeacon[beaconId] ?? []) {
    const key = channelKey('relay', id);
    const act = s.activity[key];
    s.readStates[key] = { lastReadId: act?.lastId ?? null, lastReadAt: act?.lastAt ?? null, mentionCount: 0 };
  }
  setState({ readStates: { ...s.readStates } });
  await optional(http.post(`/beacons/${beaconId}/ack`), undefined).catch(() => {});
}

const lastTypingSent = new Map<ChannelKey, number>();
export function notifyTyping(key: ChannelKey) {
  const now = Date.now();
  if (now - (lastTypingSent.get(key) ?? 0) < 8000) return;
  lastTypingSent.set(key, now);
  const { type, id } = parseChannelKey(key);
  void optional(http.post(`/channels/${type}/${id}/typing`), undefined).catch(() => {});
}

// ---------------------------------------------------------------------------
// Presence, relationships, DMs, beacons
// ---------------------------------------------------------------------------

export function setMyPresence(status: Presence) {
  const me = getState().me;
  if (!me) return;
  setPresence(me.id, { status });
  gateway.updatePresence(status);
  try {
    localStorage.setItem('subspace_presence', status);
  } catch {
    /* ignore */
  }
}

export async function openDirectLink(userId: string): Promise<string> {
  const existing = Object.values(getState().links).find((l) => l.recipient.id === userId);
  if (existing) return existing.id;
  const res = await http.post<{ link: Raw }>('/links', { targetId: userId });
  const link = toLink(res.link, getState().me!.id);
  setState((s) => ({ links: { ...s.links, [link.id]: link } }));
  return link.id;
}

export async function refreshRelationships() {
  const res = await http.get<Raw>('/affiliations');
  const rels = toRelationships(res, getState().me!.id);
  rememberUsers(rels.map((r) => r.user));
  setState({ relationships: Object.fromEntries(rels.map((r) => [r.user.id, r])) });
}

export async function sendFriendRequest(tag: string, note?: string) {
  const [username, discriminator] = tag.split('#');
  await http.post('/affiliations/request', { username: username.trim().toLowerCase(), discriminator, greetingNote: note });
  await refreshRelationships();
}

export async function respondFriendRequest(relationshipId: string, accept: boolean) {
  await http.post(`/affiliations/${relationshipId}/${accept ? 'accept' : 'decline'}`);
  await refreshRelationships();
}

export async function removeRelationship(userId: string) {
  await http.delete(`/affiliations/${userId}`);
  await refreshRelationships();
}

export async function blockUser(userId: string) {
  await http.post('/blacklist', { targetId: userId, targetType: 'transmitter' });
  await refreshRelationships().catch(() => {});
}

export async function unblockUser(userId: string) {
  await http.delete(`/blacklist/${userId}`);
  await refreshRelationships().catch(() => {});
}

export async function createBeacon(name: string, iconUrl?: string | null): Promise<string> {
  const res = await http.post<{ beacon: Raw }>('/beacons', { name, iconUrl: iconUrl ?? undefined });
  const beacon = toBeacon(res.beacon);
  setState((s) => ({ beacons: { ...s.beacons, [beacon.id]: beacon }, beaconOrder: [...s.beaconOrder, beacon.id] }));
  return beacon.id;
}

export async function leaveBeacon(beaconId: string) {
  await http.post(`/beacons/${beaconId}/leave`);
  setState((s) => {
    const beacons = { ...s.beacons };
    delete beacons[beaconId];
    return { beacons, beaconOrder: s.beaconOrder.filter((id) => id !== beaconId) };
  });
}

export async function acceptInvite(code: string): Promise<string> {
  const res = await http.post<{ beacon: Raw }>(`/invites/${code}/accept`);
  const beacon = toBeacon(res.beacon);
  setState((s) => ({
    beacons: { ...s.beacons, [beacon.id]: beacon },
    beaconOrder: s.beaconOrder.includes(beacon.id) ? s.beaconOrder : [...s.beaconOrder, beacon.id],
  }));
  return beacon.id;
}

export async function loadTransmissionRequests() {
  const res = await optional(http.get<{ requests: Raw[] }>('/requests'), { requests: [] });
  const list = res.requests.map((r) => ({
    id: r.id,
    sender: toUserRef({ id: r.senderId, username: r.senderUsername, discriminator: r.senderDiscriminator, displayName: r.senderName, avatarUrl: r.senderAvatar }),
    content: r.initialTransmission,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    mutualBeaconId: r.mutualBeaconId,
  }));
  rememberUsers(list.map((r) => r.sender));
  setState({ transmissionRequests: Object.fromEntries(list.map((r) => [r.id, r])) });
}

/** Accept opens the Direct Link (with the introductory transmission); returns its id. */
export async function respondTransmissionRequest(id: string, accept: boolean): Promise<string | null> {
  const res = await http.post<{ linkId?: string }>(`/requests/${id}/${accept ? 'accept' : 'decline'}`);
  setState((s) => {
    const transmissionRequests = { ...s.transmissionRequests };
    delete transmissionRequests[id];
    return { transmissionRequests };
  });
  if (accept) await bootstrapLinks();
  return res.linkId ?? null;
}

async function bootstrapLinks() {
  const me = getState().me;
  if (!me) return;
  const res = await optional(http.get<{ links: Raw[] }>('/links'), { links: [] });
  const links = res.links.map((l) => toLink(l, me.id));
  rememberUsers(links.map((l) => l.recipient));
  setState((s) => ({ links: { ...s.links, ...Object.fromEntries(links.map((l) => [l.id, l])) } }));
}

export async function signOut() {
  gateway.disconnect();
  await api.logout();
}
