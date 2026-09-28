import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useStore, getState } from '../../data/store';
import { memberColor } from '../../data/selectors';
import { resolveName } from '../../lib/normalize';
import { openPopout } from '../../app/ui';
import type { MarkdownResolvers } from './markdown';

/** Markdown resolvers bound to a beacon context (or none for DMs). */
export function useMarkdownResolvers(beaconId?: string): MarkdownResolvers {
  const navigate = useNavigate();
  const meId = useStore((s) => s.me?.id);
  return useMemo<MarkdownResolvers>(
    () => ({
      selfId: meId,
      user: (id) => {
        const s = getState();
        const user = s.users[id];
        if (!user) return null;
        const member = beaconId ? s.members[beaconId]?.[id] : undefined;
        return { label: resolveName(user, member), color: memberColor(s, beaconId, member) };
      },
      role: (id) => {
        const c = beaconId ? getState().clearances[beaconId]?.find((x) => x.id === id) : undefined;
        return c ? { label: c.name, color: c.color } : null;
      },
      channel: (id) => {
        const r = getState().relays[id];
        return r ? { label: r.name } : null;
      },
      glyph: (id) => glyphUrl(id),
      onUserClick: (id, e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openPopout({ userId: id, beaconId, rect, side: 'right' });
      },
      onChannelClick: (id) => {
        const r = getState().relays[id];
        if (r) navigate(`/channels/${r.beaconId}/${id}`);
      },
    }),
    [beaconId, meId, navigate]
  );
}

/** Glyph URLs are cached from any beacon the user has loaded. */
const glyphCache = new Map<string, string>();
export const rememberGlyphs = (glyphs: Array<{ id: string; url: string }>) => glyphs.forEach((g) => glyphCache.set(g.id, g.url));
export const glyphUrl = (id: string) => glyphCache.get(id) ?? null;
