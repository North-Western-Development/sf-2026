import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { clsx } from 'clsx';
import { ArrowUpDown, ChevronLeft, ChevronRight, Link2, MailWarning, MoreVertical, Search, Sparkle, UserRound, Users } from 'lucide-react';
import { Button, Modal, Tooltip, useContextMenu } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { confirmAction, openPopout, toast } from '../../app/ui';
import { http, optional } from '../../lib/http';
import { formatAgo } from '../../lib/time';
import { term } from '../../lib/strings';
import { userTag } from '../../lib/normalize';
import type { Member, UserRef } from '../../lib/types';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { memberMenu } from '../members/memberMenu';
import { MobileNavButton } from '../../app/mobile';

interface Details {
  transmitterId: string;
  joinedAt: string;
  accountCreatedAt: string;
  joinMethod: 'invite' | 'discovery' | 'owner' | 'unknown';
  inviteCode: string | null;
  inviter: Pick<UserRef, 'id' | 'username' | 'displayName' | 'avatarUrl'> & { discriminator?: string } | null;
  signals: Array<'new_account' | 'unverified_email'>;
}

const SORTS = [
  { id: 'joined_desc', label: 'Member since (newest first)' },
  { id: 'joined_asc', label: 'Member since (oldest first)' },
  { id: 'account_desc', label: 'Joined Subspace (newest first)' },
  { id: 'account_asc', label: 'Joined Subspace (oldest first)' },
] as const;
type Sort = (typeof SORTS)[number]['id'];
const PAGE_SIZES = [12, 25, 50, 100];
const SIGNALS: Record<string, { icon: React.ReactNode; label: string }> = {
  new_account: { icon: <Sparkle className="h-4 w-4 text-warning" />, label: 'New account (under a week old)' },
  unverified_email: { icon: <MailWarning className="h-4 w-4 text-warning" />, label: 'Email not verified' },
};
const MODERATION = [PERMISSIONS.KICK_MEMBERS, PERMISSIONS.BAN_MEMBERS, PERMISSIONS.MANAGE_CLEARANCES, PERMISSIONS.MANAGE_NICKNAMES];
const EMPTY: Record<string, Member> = {};

/**
 * Discord's Members page (Member Safety): every member with when they joined the beacon and
 * Subspace, how they joined, their clearances and safety signals. Search, sort, page, select
 * for bulk kick or ban, and prune inactive members.
 */
export function MembersPage() {
  const { beaconId = '' } = useParams();
  const beacon = useStore((s) => s.beacons[beaconId]);
  const members = useStore((s) => s.members[beaconId] ?? EMPTY);
  const clearances = useStore(useShallow((s) => [...(s.clearances[beaconId] ?? [])].sort((a, b) => b.position - a.position)));
  const perms = useStore((s) => beaconPermissions(s, beaconId));
  const meId = useStore((s) => s.me?.id);
  const allowed = MODERATION.some((p) => can(perms, p));
  const canKick = can(perms, PERMISSIONS.KICK_MEMBERS);
  const canBan = can(perms, PERMISSIONS.BAN_MEMBERS);
  const { openContextMenu } = useContextMenu();

  const [details, setDetails] = useState<Record<string, Details>>({});
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('joined_desc');
  const [pageSize, setPageSize] = useState(12);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pruning, setPruning] = useState(false);

  const reload = () =>
    void optional(http.get<{ members: Details[] }>(`/beacons/${beaconId}/member-details`), { members: [] }).then((r) =>
      setDetails(Object.fromEntries(r.members.map((m) => [m.transmitterId, m])))
    );
  useEffect(() => {
    if (allowed) reload();
  }, [beaconId, allowed, Object.keys(members).length]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = Object.values(members).filter(
      (m) => !q || m.transmitterId === q || m.user.username.includes(q) || (m.nickname ?? '').toLowerCase().includes(q) || (m.user.displayName ?? '').toLowerCase().includes(q)
    );
    const at = (m: Member, f: 'joinedAt' | 'accountCreatedAt') => new Date(details[m.transmitterId]?.[f] ?? m.joinedAt ?? 0).getTime();
    const by: Record<Sort, (a: Member, b: Member) => number> = {
      joined_desc: (a, b) => at(b, 'joinedAt') - at(a, 'joinedAt'),
      joined_asc: (a, b) => at(a, 'joinedAt') - at(b, 'joinedAt'),
      account_desc: (a, b) => at(b, 'accountCreatedAt') - at(a, 'accountCreatedAt'),
      account_asc: (a, b) => at(a, 'accountCreatedAt') - at(b, 'accountCreatedAt'),
    };
    return list.sort(by[sort]);
  }, [members, details, query, sort]);

  if (!beacon) return null;
  if (!allowed) return <Navigate to={`/channels/${beaconId}`} replace />;

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * pageSize, current * pageSize + pageSize);
  const allShown = shown.length > 0 && shown.every((m) => selected.has(m.transmitterId));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const others = [...selected].filter((id) => id !== meId && id !== beacon.ownerId);

  const bulk = (action: 'kick' | 'ban') =>
    confirmAction({
      title: `${action === 'kick' ? 'Kick' : 'Ban'} ${others.length} member${others.length === 1 ? '' : 's'}`,
      body: action === 'kick' ? 'They can rejoin with a new invite.' : 'They will not be able to rejoin unless the ban is revoked.',
      confirmLabel: action === 'kick' ? 'Kick' : 'Ban',
      danger: true,
      onConfirm: async () => {
        const results = await Promise.allSettled(
          others.map((id) => (action === 'kick' ? http.post(`/beacons/${beaconId}/members/${id}/kick`, {}) : http.put(`/beacons/${beaconId}/bans/${id}`, {})))
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        setSelected(new Set());
        toast(failed ? `${failed} could not be ${action === 'kick' ? 'kicked' : 'banned'} (rank too high?)` : 'Done', failed ? 'error' : 'success');
      },
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <MobileNavButton />
        <Users className="h-5 w-5 text-fg-subtle" />
        <h1 className="font-semibold text-fg">Members</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <section className="min-w-[860px] rounded-xl bg-raised ring-1 ring-line">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h2 className="mr-auto font-semibold text-fg">{selected.size ? `${selected.size} selected` : 'Recent Members'}</h2>
            {selected.size > 0 ? (
              <>
                {canKick && (
                  <Button size="sm" variant="outline" disabled={!others.length} onClick={() => bulk('kick')}>
                    Kick
                  </Button>
                )}
                {canBan && (
                  <Button size="sm" variant="danger" disabled={!others.length} onClick={() => bulk('ban')}>
                    Ban
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </>
            ) : (
              <>
                <label className="flex h-8 w-64 items-center gap-2 rounded-md bg-void px-2 ring-1 ring-line focus-within:ring-brand-sky">
                  <Search className="h-4 w-4 text-fg-subtle" />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                    placeholder="Search by username or id"
                    aria-label="Search members"
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
                  />
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    openContextMenu({ clientX: r.left, clientY: r.bottom + 4 }, SORTS.map((s) => ({ label: s.label, checked: sort === s.id, onClick: () => setSort(s.id) })));
                  }}
                >
                  <ArrowUpDown className="h-4 w-4" /> Sort
                </Button>
                {canKick && (
                  <Button size="sm" variant="outline" className="!border-danger !text-danger" onClick={() => setPruning(true)}>
                    Prune
                  </Button>
                )}
              </>
            )}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-fg-muted">
                <th className="w-10 py-2 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allShown}
                    onChange={() => setSelected((s) => (allShown ? new Set([...s].filter((id) => !shown.some((m) => m.transmitterId === id))) : new Set([...s, ...shown.map((m) => m.transmitterId)])))}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                </th>
                <th className="py-2">Name</th>
                <th className="py-2">Member Since</th>
                <th className="py-2">Joined Subspace</th>
                <th className="py-2">Join Method</th>
                <th className="py-2">{term('clearance', true)}</th>
                <th className="py-2">Signals</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const d = details[m.transmitterId];
                const held = clearances.filter((c) => m.clearanceIds.includes(c.id) && c.position > 0);
                return (
                  <tr key={m.transmitterId} className={clsx('border-t border-line', selected.has(m.transmitterId) && 'bg-brand/5')}>
                    <td className="py-2.5 pl-4">
                      <input type="checkbox" aria-label={`Select ${m.user.username}`} checked={selected.has(m.transmitterId)} onChange={() => toggle(m.transmitterId)} className="h-4 w-4 accent-[var(--color-brand)]" />
                    </td>
                    <td className="py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar user={m.user} src={m.avatarUrl} size={32} />
                        <span className="min-w-0">
                          <UserName user={m.user} beaconId={beaconId} className="block truncate font-medium" />
                          <span className="block truncate text-xs text-fg-subtle">{userTag(m.user)}</span>
                        </span>
                      </span>
                    </td>
                    <td className="text-fg">{m.joinedAt ? formatAgo(m.joinedAt) : '—'}</td>
                    <td className="text-fg">{d ? formatAgo(d.accountCreatedAt) : '—'}</td>
                    <td>
                      <JoinMethod d={d} />
                    </td>
                    <td>
                      <span className="flex items-center gap-1">
                        {held[0] && (
                          <span className="flex items-center gap-1 rounded-md bg-overlay px-1.5 py-0.5 text-xs text-fg ring-1 ring-line">
                            <span className="h-2 w-2 rounded-full" style={{ background: held[0].color }} />
                            {held[0].name}
                          </span>
                        )}
                        {held.length > 1 && (
                          <Tooltip content={held.slice(1).map((c) => c.name).join(', ')}>
                            <span className="text-xs text-fg-muted">+{held.length - 1}</span>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5">
                        {d?.signals.map((s) => (
                          <Tooltip key={s} content={SIGNALS[s].label}>
                            <span role="img" aria-label={SIGNALS[s].label}>
                              {SIGNALS[s].icon}
                            </span>
                          </Tooltip>
                        ))}
                      </span>
                    </td>
                    <td className="pr-3">
                      <span className="flex items-center justify-end gap-1">
                        <Tooltip content="View profile">
                          <button
                            type="button"
                            aria-label={`View ${m.user.username}'s profile`}
                            onClick={(e) => openPopout({ userId: m.transmitterId, beaconId, rect: e.currentTarget.getBoundingClientRect(), side: 'left' })}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
                          >
                            <UserRound className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <button
                          type="button"
                          aria-label={`More options for ${m.user.username}`}
                          onClick={(e) => openContextMenu({ clientX: e.clientX, clientY: e.clientY }, memberMenu(beaconId, m.transmitterId))}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-10 text-center text-sm text-fg-subtle">No members match “{query}”.</p>}

          <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm text-fg-muted">
            Showing
            <select
              value={pageSize}
              aria-label="Members per page"
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="h-8 rounded-md border border-line bg-void px-2 text-fg"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            members of {rows.length}
            <nav aria-label="Pages" className="ml-auto flex items-center gap-1">
              <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="flex items-center gap-1 rounded-md px-2 py-1 enabled:hover:text-fg disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              {Array.from({ length: pages }, (_, i) => i)
                .filter((i) => i < 3 || Math.abs(i - current) < 2 || i === pages - 1)
                .map((i) => (
                  <button
                    key={i}
                    type="button"
                    aria-current={i === current ? 'page' : undefined}
                    onClick={() => setPage(i)}
                    className={clsx('h-7 min-w-7 rounded-full px-2 text-sm', i === current ? 'bg-brand text-on-brand' : 'hover:bg-hover hover:text-fg')}
                  >
                    {i + 1}
                  </button>
                ))}
              <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="flex items-center gap-1 rounded-md px-2 py-1 enabled:hover:text-fg disabled:opacity-40">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </nav>
          </div>
        </section>
      </div>
      {pruning && <PruneDialog beaconId={beaconId} onClose={() => setPruning(false)} onDone={reload} />}
    </div>
  );
}

function JoinMethod({ d }: { d?: Details }) {
  if (!d) return <span className="text-fg-subtle">—</span>;
  if (d.joinMethod === 'invite' && d.inviteCode) {
    const chip = (
      <span className="inline-flex items-center gap-1 rounded-md bg-overlay px-1.5 py-0.5 font-mono text-xs text-fg ring-1 ring-line">
        <Link2 className="h-3 w-3" /> {d.inviteCode}
      </span>
    );
    return d.inviter ? <Tooltip content={`Invited by ${d.inviter.displayName || d.inviter.username}`}>{chip}</Tooltip> : chip;
  }
  const label = { discovery: 'Discover', owner: 'Created it', invite: 'Invite', unknown: 'Unknown' }[d.joinMethod];
  return <span className="text-xs text-fg-muted">{label}</span>;
}

function PruneDialog({ beaconId, onClose, onDone }: { beaconId: string; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState(7);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCount(null);
    void http.get<{ count: number }>(`/beacons/${beaconId}/prune?days=${days}`).then((r) => setCount(r.count), () => setCount(0));
  }, [beaconId, days]);
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Prune members"
      description={`Remove members who have no ${term('clearance', true).toLowerCase()}, joined over ${days} day${days === 1 ? '' : 's'} ago and have not transmitted since. They can rejoin with an invite.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isLoading={busy}
            disabled={!count}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await http.post<{ pruned: number }>(`/beacons/${beaconId}/prune`, { days });
                toast(`Pruned ${r.pruned} member${r.pruned === 1 ? '' : 's'}`, 'success');
                onDone();
                onClose();
              } catch (err) {
                toast((err as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Prune {count ?? ''}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Inactive for" className="flex gap-2">
        {[1, 7, 30].map((d) => (
          <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={clsx('flex-1 rounded-md py-2 text-sm ring-1', days === d ? 'bg-brand/10 text-fg ring-brand' : 'text-fg-muted ring-line hover:bg-hover')}>
            {d} day{d === 1 ? '' : 's'}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-fg">{count === null ? 'Counting…' : `${count} member${count === 1 ? '' : 's'} would be removed.`}</p>
    </Modal>
  );
}

