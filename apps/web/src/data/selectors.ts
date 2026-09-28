import { useShallow } from 'zustand/react/shallow';
import { useStore, type SubspaceState } from './store';
import { channelKey, type ChannelKey, type Member, type UserRef } from '../lib/types';
import { effectiveNotification, isMuted, settingFor } from './notifications';

/** Unread = newer activity than the read marker. Muted channels never show unread. */
export function isUnread(s: SubspaceState, key: ChannelKey): boolean {
  const act = s.activity[key];
  if (!act?.lastAt) return false;
  if (act.lastId && s.messages[key]?.byId[act.lastId]?.author.id === s.me?.id) return false;
  const rs = s.readStates[key];
  if (!rs?.lastReadAt) return !!act.lastId && act.lastId !== rs?.lastReadId;
  return act.lastAt > rs.lastReadAt && act.lastId !== rs.lastReadId;
}

export const mentionCount = (s: SubspaceState, key: ChannelKey) => s.readStates[key]?.mentionCount ?? 0;

export function channelIndicator(s: SubspaceState, key: ChannelKey) {
  const eff = effectiveNotification(s, key);
  return {
    unread: !eff.muted && isUnread(s, key),
    mentions: mentionCount(s, key),
    muted: eff.muted,
  };
}

export function beaconIndicator(s: SubspaceState, beaconId: string) {
  const muted = isMuted(settingFor(s, 'beacon', beaconId));
  let unread = false;
  let mentions = 0;
  for (const id of s.relayIdsByBeacon[beaconId] ?? []) {
    const key = channelKey('relay', id);
    const ind = channelIndicator(s, key);
    unread ||= ind.unread;
    mentions += ind.mentions;
  }
  // Relays not loaded yet: fall back to activity entries tagged with this beacon.
  if (!s.relayIdsByBeacon[beaconId]) {
    for (const [key, act] of Object.entries(s.activity) as Array<[ChannelKey, { beaconId?: string }]>) {
      if (act.beaconId !== beaconId) continue;
      const ind = channelIndicator(s, key);
      unread ||= ind.unread;
      mentions += ind.mentions;
    }
  }
  return { unread: unread && !muted, mentions, muted };
}

/** Total DM/mesh mentions for the Home button. */
export function homeMentions(s: SubspaceState): number {
  let n = 0;
  for (const id of Object.keys(s.links)) n += mentionCount(s, channelKey('link', id));
  for (const id of Object.keys(s.meshes)) n += mentionCount(s, channelKey('mesh', id));
  n += Object.values(s.relationships).filter((r) => r.type === 'incoming').length;
  n += Object.keys(s.transmissionRequests).length;
  return n;
}

export const useChannelIndicator = (key: ChannelKey) => useStore(useShallow((s) => channelIndicator(s, key)));
export const useBeaconIndicator = (beaconId: string) => useStore(useShallow((s) => beaconIndicator(s, beaconId)));

/** Highest-positioned colored clearance for a member. */
export function memberColor(s: SubspaceState, beaconId: string | undefined, member?: Member): string | null {
  if (!beaconId || !member) return null;
  const list = s.clearances[beaconId] ?? [];
  let best: { position: number; color: string } | null = null;
  for (const c of list) {
    if (!member.clearanceIds.includes(c.id) || c.position === 0) continue;
    if (!c.color || c.color.toUpperCase() === '#99AAB5') continue;
    if (!best || c.position > best.position) best = c;
  }
  return best?.color ?? null;
}

export function nameStyleColor(user: UserRef): string | null {
  return user.displayNameStyle?.colors?.[0] ?? null;
}
