import { prefetchProfile } from '../profile/useProfile';
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useContextMenu } from '@subspace/ui';
import { useStore } from '../../data/store';
import type { Member, Presence } from '../../lib/types';
import { openPopout } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { memberMenu } from './memberMenu';

const ONLINE: Presence[] = ['online', 'idle', 'dnd', 'away'];

function MemberRow({ member, beaconId, offline }: { member: Member; beaconId: string; offline: boolean }) {
  const status = useStore((s) => s.presence[member.transmitterId]);
  const { openContextMenu } = useContextMenu();
  return (
    <button
      type="button"
      onClick={(e) => openPopout({ userId: member.transmitterId, beaconId, rect: e.currentTarget.getBoundingClientRect(), side: 'left' })}
      onContextMenu={(e) => openContextMenu(e, memberMenu(beaconId, member.transmitterId))}
      onPointerEnter={() => prefetchProfile(member.transmitterId, beaconId)}
      className={clsx('flex h-11 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-hover', offline && 'opacity-40 hover:opacity-100')}
    >
      <Avatar user={member.user} src={member.avatarUrl} size={32} showPresence={!offline} ring="var(--color-raised)" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <UserName user={member.user} beaconId={beaconId} className="text-[15px] font-medium" />
          {member.isOwner && <span title="Beacon Owner" aria-label="Beacon Owner" className="text-star text-xs">★</span>}
        </span>
        {!offline && status?.customStatus?.text && <span className="block truncate text-xs text-fg-subtle">{status.customStatus.text}</span>}
      </span>
    </button>
  );
}

/** Members grouped Discord-style: hoisted clearances (by position), then Online, then Offline. */
export function MemberList({ beaconId }: { beaconId: string }) {
  const members = useStore((s) => s.members[beaconId]);
  const clearances = useStore((s) => s.clearances[beaconId]);
  const presence = useStore(useShallow((s) => Object.fromEntries(Object.keys(s.members[beaconId] ?? {}).map((id) => [id, s.presence[id]?.status ?? 'offline']))));

  const groups = useMemo(() => {
    const list = Object.values(members ?? {});
    const hoisted = (clearances ?? []).filter((c) => c.hoist && c.position > 0).sort((a, b) => b.position - a.position);
    const byName = (a: Member, b: Member) =>
      (a.nickname || a.user.displayName || a.user.username).localeCompare(b.nickname || b.user.displayName || b.user.username);
    const placed = new Set<string>();
    const out: Array<{ id: string; title: string; members: Member[]; offline?: boolean }> = [];
    for (const c of hoisted) {
      const inRole = list.filter((m) => !placed.has(m.transmitterId) && ONLINE.includes(presence[m.transmitterId] as Presence) && m.clearanceIds.includes(c.id)).sort(byName);
      inRole.forEach((m) => placed.add(m.transmitterId));
      if (inRole.length) out.push({ id: c.id, title: c.name, members: inRole });
    }
    const online = list.filter((m) => !placed.has(m.transmitterId) && ONLINE.includes(presence[m.transmitterId] as Presence)).sort(byName);
    if (online.length) out.push({ id: 'online', title: 'Online', members: online });
    const offline = list.filter((m) => !ONLINE.includes(presence[m.transmitterId] as Presence)).sort(byName);
    if (offline.length) out.push({ id: 'offline', title: 'Offline', members: offline, offline: true });
    return out;
  }, [members, clearances, presence]);

  return (
    <aside aria-label="Members" className="w-60 shrink-0 overflow-y-auto bg-raised px-2 pb-4">
      {!members ? (
        <div className="space-y-3 px-2 pt-6">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-hover" />
              <div className="h-3 animate-pulse rounded bg-hover" style={{ width: `${40 + ((i * 13) % 40)}%` }} />
            </div>
          ))}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.id}>
            <h3 className="px-2 pb-1 pt-6 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {g.title} — {g.members.length}
            </h3>
            {g.members.map((m) => (
              <MemberRow key={m.transmitterId} member={m} beaconId={beaconId} offline={!!g.offline} />
            ))}
          </section>
        ))
      )}
    </aside>
  );
}
