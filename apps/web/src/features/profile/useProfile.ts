import { useEffect, useState } from 'react';
import { http, optional } from '../../lib/http';
import { toUserRef } from '../../lib/normalize';
import { useStore } from '../../data/store';
import type { CustomStatus, DisplayNameStyle, UserRef } from '../../lib/types';

export interface FullProfile {
  user: UserRef & {
    pronouns?: string | null;
    bannerUrl?: string | null;
    bannerColor?: string | null;
    themePrimary?: string | null;
    themeAccent?: string | null;
    bio?: string | null;
    customStatus?: CustomStatus | null;
    createdAt?: string;
  };
  member?: {
    nickname: string | null;
    avatarUrl?: string | null;
    bannerUrl?: string | null;
    bio?: string | null;
    pronouns?: string | null;
    themePrimary?: string | null;
    themeAccent?: string | null;
    displayNameStyle?: DisplayNameStyle | null;
    joinedAt?: string;
    clearances: Array<{ id: string; name: string; color: string }>;
  };
  commendations: Array<{ code: string; name: string; iconUrl: string; description: string }>;
  mutualBeacons: Array<{ id: string; name: string; iconUrl: string | null; nickname?: string | null }>;
  mutualFriends: UserRef[];
  relationship: 'self' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';
  note: string | null;
}

/** Recently loaded profiles, so popouts open with badges already in place. */
const cache = new Map<string, { at: number; data: FullProfile }>();
const inflight = new Map<string, Promise<FullProfile | null>>();
const cacheKey = (userId: string, beaconId?: string) => `${userId}:${beaconId ?? ''}`;
const FRESH_MS = 60_000;

/** Fetches a profile unless one newer than maxAge is cached; concurrent callers share the request. */
export function loadProfile(userId: string, beaconId?: string, maxAge = 0): Promise<FullProfile | null> {
  const key = cacheKey(userId, beaconId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAge) return Promise.resolve(hit.data);
  const pending = inflight.get(key);
  if (pending) return pending;
  const q = beaconId ? `?beaconId=${beaconId}` : '';
  const req = optional(http.get<FullProfile>(`/users/${userId}/profile${q}`), null)
    .then((p) => {
      if (!p) return null;
      const data = { ...p, user: { ...toUserRef(p.user), ...p.user } };
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, req);
  return req;
}

/** Warms the cache when a profile is about to be opened (hover, startup). */
export const prefetchProfile = (userId: string, beaconId?: string) => void loadProfile(userId, beaconId, FRESH_MS);

/** Loads GET /users/:id/profile (cached first, then refreshed), falling back to what the client already knows. */
export function useProfile(userId: string, beaconId?: string) {
  const cachedUser = useStore((s) => s.users[userId]);
  const member = useStore((s) => (beaconId ? s.members[beaconId]?.[userId] : undefined));
  const clearances = useStore((s) => (beaconId ? s.clearances[beaconId] : undefined));
  const rel = useStore((s) => s.relationships[userId]);
  const meId = useStore((s) => s.me?.id);
  const [profile, setProfile] = useState<FullProfile | null>(() => cache.get(cacheKey(userId, beaconId))?.data ?? null);

  useEffect(() => {
    let cancelled = false;
    setProfile(cache.get(cacheKey(userId, beaconId))?.data ?? null);
    void loadProfile(userId, beaconId).then((p) => {
      if (!cancelled && p) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, beaconId]);

  if (profile) return profile;
  if (!cachedUser) return null;
  return {
    user: cachedUser,
    member: member
      ? {
          nickname: member.nickname,
          joinedAt: member.joinedAt,
          clearances: (clearances ?? []).filter((c) => member.clearanceIds.includes(c.id) && c.position > 0).map((c) => ({ id: c.id, name: c.name, color: c.color })),
        }
      : undefined,
    commendations: [],
    mutualBeacons: [],
    mutualFriends: [],
    relationship: userId === meId ? 'self' : rel?.type ?? 'none',
    note: null,
  } satisfies FullProfile;
}
