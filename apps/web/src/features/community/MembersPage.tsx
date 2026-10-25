import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { clsx } from 'clsx';
import { ArrowUpDown, ChevronLeft, ChevronRight, Link2, MessageCircleWarning, MoreVertical, Search, ShieldX, SlidersVertical, TimerOff, UserRound, UserRoundX, Users } from 'lucide-react';
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
  signals: Array<{ type: SignalType; detail: string }>;
}
type SignalType = 'unusual_dm_activity' | 'timed_out' | 'unusual_account_activity' | 'quarantined';

/** Age buckets the Member Since and Joined Subspace filters offer. */
const AGES = [
  { id: 'hour', label: 'Within the last hour', ms: 3_600_000 },
  { id: 'day', label: 'Within the last day', ms: 86_400_000 },
  { id: 'week', label: 'Within the last week', ms: 7 * 86_400_000 },
  { id: 'month', label: 'Within the last month', ms: 30 * 86_400_000 },
  { id: 'older', label: 'More than a month ago', ms: Infinity },
] as const;
const ageBucket = (iso: string | undefined) => {
  if (!iso) return 'older';
  const age = Date.now() - new Date(iso).getTime();
  return AGES.find((a) => age <= a.ms)!.id;
};
interface Filters {
  memberSince: Set<string>;
  account: Set<string>;
  joinMethod: Set<string>;
  clearances: Set<string>;
  signals: Set<string>;
}
const NO_FILTERS: Filters = { memberSince: new Set(), account: new Set(), joinMethod: new Set(), clearances: new Set(), signals: new Set() };
const joinKey = (d?: Details) => (d?.joinMethod === 'invite' && d.inviteCode ? `invite:${d.inviteCode}` : d?.joinMethod ?? 'unknown');

const SORTS = [
  { id: 'joined_desc', label: 'Member since (newest first)' },
  { id: 'joined_asc', label: 'Member since (oldest first)' },
  { id: 'account_desc', label: 'Joined Subspace (newest first)' },
  { id: 'account_asc', label: 'Joined Subspace (oldest first)' },
] as const;
type Sort = (typeof SORTS)[number]['id'];
const PAGE_SIZES = [12, 25, 50, 100];
/** Discord's member signals, in its order. */
const SIGNALS: Record<SignalType, { icon: React.ReactNode; label: string }> = {
  unusual_dm_activity: { icon: <MessageCircleWarning className="h-4 w-4 text-warning" />, label: 'Unusual DM Activity' },
  timed_out: { icon: <TimerOff className="h-4 w-4 text-warning" />, label: 'Timed Out' },
  unusual_account_activity: { icon: <UserRoundX className="h-4 w-4 text-warning" />, label: 'Unusual Account Activity' },
  quarantined: { icon: <ShieldX className="h-4 w-4 text-danger" />, label: 'Quarantined' },
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
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const toggleFilter = (k: keyof Filters, v: string) => {
    setFilters((f) => {
      const next = new Set(f[k]);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return { ...f, [k]: next };
    });
    setPage(0);
  };

  const reload = () =>
    void optional(http.get<{ members: Details[] }>(`/beacons/${beaconId}/member-details`), { members: [] }).then((r) =>
      setDetails(Object.fromEntries(r.members.map((m) => [m.transmitterId, m])))
    );
  useEffect(() => {
    if (allowed) reload();
  }, [beaconId, allowed, Object.keys(members).length]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Each column filter narrows by any of its checked values.
    const pass = (set: Set<string>, ...values: string[]) => !set.size || values.some((v) => set.has(v));
    const list = Object.values(members).filter((m) => {
      const d = details[m.transmitterId];
      return (
        (!q || m.transmitterId === q || m.user.username.includes(q) || (m.nickname ?? '').toLowerCase().includes(q) || (m.user.displayName ?? '').toLowerCase().includes(q)) &&
        pass(filters.memberSince, ageBucket(m.joinedAt)) &&
        pass(filters.account, ageBucket(d?.accountCreatedAt)) &&
        pass(filters.joinMethod, joinKey(d)) &&
        pass(filters.clearances, ...m.clearanceIds) &&
        pass(filters.signals, ...(d?.signals.map((s) => s.type) ?? []))
      );
    });
    const at = (m: Member, f: 'joinedAt' | 'accountCreatedAt') => new Date(details[m.transmitterId]?.[f] ?? m.joinedAt ?? 0).getTime();
    const by: Record<Sort, (a: Member, b: Member) => number> = {
      joined_desc: (a, b) => at(b, 'joinedAt') - at(a, 'joinedAt'),
      joined_asc: (a, b) => at(a, 'joinedAt') - at(b, 'joinedAt'),
      account_desc: (a, b) => at(b, 'accountCreatedAt') - at(a, 'accountCreatedAt'),
      account_asc: (a, b) => at(a, 'accountCreatedAt') - at(b, 'accountCreatedAt'),
    };
    return list.sort(by[sort]);
  }, [members, details, query, sort, filters]);

  if (!beacon) return null;
  if (!allowed) return <Navigate to={`/channels/${beaconId}`} replace />;

  // Join methods present in this beacon: each invite code, plus Discover / creator / unknown.
  const joinOptions = [...new Set(Object.values(details).map((d) => joinKey(d)))]
    .sort()
    .map((k) => ({
      value: k,
      label: k.startsWith('invite:') ? k.slice(7) : { discovery: 'Discover', owner: 'Created it', unknown: 'Unknown', invite: 'Invite' }[k] ?? k,
      icon: k.startsWith('invite:') ? <Link2 className="h-3.5 w-3.5" /> : undefined,
    }));

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
                <FilterHeader label="Member Since" options={AGES.map((a) => ({ value: a.id, label: a.label }))} chosen={filters.memberSince} onToggle={(v) => toggleFilter('memberSince', v)} />
                <FilterHeader label="Joined Subspace" options={AGES.map((a) => ({ value: a.id, label: a.label }))} chosen={filters.account} onToggle={(v) => toggleFilter('account', v)} />
                <FilterHeader label="Join Method" options={joinOptions} chosen={filters.joinMethod} onToggle={(v) => toggleFilter('joinMethod', v)} />
                <FilterHeader
                  label={term('clearance', true)}
                  align="right"
                  options={clearances.filter((c) => c.position > 0).map((c) => ({ value: c.id, label: c.name, icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /> }))}
                  chosen={filters.clearances}
                  onToggle={(v) => toggleFilter('clearances', v)}
                />
                <FilterHeader
                  label="Signals"
                  align="right"
                  options={(Object.keys(SIGNALS) as SignalType[]).map((k) => ({ value: k, label: SIGNALS[k].label, icon: SIGNALS[k].icon }))}
                  chosen={filters.signals}
                  onToggle={(v) => toggleFilter('signals', v)}
                />
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
                          <Tooltip
                            key={s.type}
                            content={
                              <span>
                                <span className="block font-semibold">{SIGNALS[s.type].label}</span>
                                <span className="block text-fg-muted">{s.type === 'timed_out' ? `Until ${new Date(s.detail.replace('Timed out until ', '')).toLocaleString()}` : s.detail}</span>
                              </span>
                            }
                          >
                            <span role="img" aria-label={SIGNALS[s.type].label}>
                              {SIGNALS[s.type].icon}
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


/** A column header with Discord's filter control: a checkbox list of values to narrow by. */
function FilterHeader({
  label,
  options,
  chosen,
  onToggle,
  align = 'left',
}: {
  label: string;
  options: Array<{ value: string; label: string; icon?: React.ReactNode }>;
  chosen: Set<string>;
  onToggle: (v: string) => void;
  /** Right-aligned popups for the last columns keep the list on screen. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <th ref={ref} className="relative py-2">
      <span className="flex items-center gap-1">
        {label}
        <button
          type="button"
          aria-label={`Filter by ${label}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={clsx('flex h-6 w-6 items-center justify-center rounded-md hover:bg-hover hover:text-fg', chosen.size ? 'text-brand-sky' : 'text-fg-subtle')}
        >
          <SlidersVertical className="h-3.5 w-3.5" />
        </button>
        {chosen.size > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold leading-4 text-on-brand">{chosen.size}</span>}
      </span>
      {open && (
        <div role="group" aria-label={`${label} filters`} className={clsx('absolute top-full z-30 mt-1 w-64', align === 'right' ? 'right-0' : 'left-0', ' rounded-lg bg-overlay p-1.5 font-normal shadow-pop ring-1 ring-line')}>
          {options.length === 0 && <p className="px-2 py-1.5 text-sm text-fg-subtle">Nothing to filter by yet.</p>}
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium text-fg hover:bg-hover">
              {o.icon && <span className="flex w-4 shrink-0 justify-center">{o.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <input type="checkbox" checked={chosen.has(o.value)} onChange={() => onToggle(o.value)} className="h-4 w-4 accent-[var(--color-brand)]" />
            </label>
          ))}
        </div>
      )}
    </th>
  );
}
