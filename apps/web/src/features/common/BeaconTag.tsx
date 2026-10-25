import { useEffect } from 'react';
import { create } from 'zustand';
import { Tooltip } from '@subspace/ui';
import { http } from '../../lib/http';
import { Emoji } from '../../lib/emoji';
import { useStore } from '../../data/store';

export interface TagInfo {
  id: string;
  name: string;
  tag: string;
  tagBadge: string | null;
}

/** Tags of beacons people wear, looked up in batches (the viewer may not be in those beacons). */
const useTags = create<Record<string, TagInfo | null>>()(() => ({}));
const queued = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function want(beaconId: string) {
  if (beaconId in useTags.getState() || queued.has(beaconId)) return;
  queued.add(beaconId);
  timer ??= setTimeout(() => {
    const ids = [...queued];
    queued.clear();
    timer = null;
    http
      .get<{ tags: TagInfo[] }>(`/beacon-tags?ids=${ids.join(',')}`)
      .then(({ tags }) => useTags.setState(Object.fromEntries(ids.map((id) => [id, tags.find((t) => t.id === id) ?? null]))))
      .catch(() => useTags.setState(Object.fromEntries(ids.map((id) => [id, null]))));
  }, 50);
}

/** Forget cached tags, e.g. after a beacon changes its tag. */
export const refreshBeaconTag = (beaconId: string) => useTags.setState((s) => {
  const next = { ...s };
  delete next[beaconId];
  return next;
});

/** The Beacon Tag pill Discord shows beside a name. */
export function BeaconTag({ beaconId, className }: { beaconId: string | null | undefined; className?: string }) {
  // A beacon you are in answers from the store (and updates live).
  const local = useStore((s) => (beaconId && s.beacons[beaconId]?.tag ? s.beacons[beaconId] : null));
  const fetched = useTags((s) => (beaconId ? s[beaconId] : null));
  useEffect(() => {
    if (beaconId && !local) want(beaconId);
  }, [beaconId, local]);
  const info = local ? { id: local.id, name: local.name, tag: local.tag!, tagBadge: local.tagBadge ?? null } : fetched;
  if (!beaconId || !info) return null;
  return (
    <Tooltip content={info.name}>
      <span aria-label={`Beacon tag ${info.tag} (${info.name})`} className={`inline-flex h-[18px] items-center gap-1 rounded-[4px] bg-active px-1 align-middle text-[11px] font-semibold leading-none text-fg ${className ?? ''}`}>
        {info.tagBadge && <Emoji emoji={info.tagBadge} size={12} />}
        {info.tag}
      </span>
    </Tooltip>
  );
}
