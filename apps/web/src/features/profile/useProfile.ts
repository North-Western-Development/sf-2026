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

/** Loads GET /users/:id/profile, falling back to what the client already knows. */
export function useProfile(userId: string, beaconId?: string) {
  const cachedUser = useStore((s) => s.users[userId]);
  const member = useStore((s) => (beaconId ? s.members[beaconId]?.[userId] : undefined));
  const clearances = useStore((s) => (beaconId ? s.clearances[beaconId] : undefined));
  const rel = useStore((s) => s.relationships[userId]);
  const meId = useStore((s) => s.me?.id);
  const [profile, setProfile] = useState<FullProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = beaconId ? `?beaconId=${beaconId}` : '';
    void optional(http.get<FullProfile>(`/users/${userId}/profile${q}`), null)
      .then((p) => {
        if (!cancelled && p) setProfile({ ...p, user: { ...toUserRef(p.user), ...p.user } });
      })
      .catch(() => {});
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
