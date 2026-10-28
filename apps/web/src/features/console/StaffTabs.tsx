import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Crown, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { STAFF_PERMISSION_INFO, STAFF_PERMISSIONS } from '@subspace/constants';
import { Button, Input, Modal } from '@subspace/ui';
import { http } from '../../lib/http';
import { confirmAction, toast } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { useStore } from '../../data/store';
import { RowButton, SettingsSection } from '../settings/SettingsLayout';
import { can, manages, type ConsoleMe, type CustomBadge, type StaffRole, useStaffRoles } from './consoleData';

const selectCls = 'h-8 rounded-md bg-void px-2 text-sm text-fg outline-none ring-1 ring-line focus:ring-brand';

/** A rank's name in its color. */
export function RankPill({ role }: { role: Pick<StaffRole, 'name' | 'color' | 'isRoot'> }) {
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ color: role.color, backgroundColor: `${role.color}26` }}>
      {role.isRoot && <Crown className="h-3 w-3" aria-hidden />}
      {role.name}
    </span>
  );
}

/** Choose a rank for someone (or none). Only ranks the signed-in staff member may give are offered. */
export function RankSelect({ me, roles, value, label, onChange }: { me: ConsoleMe; roles: StaffRole[]; value: string; label: string; onChange: (roleId: string | null) => void }) {
  const current = roles.find((r) => r.id === value);
  return (
    <select aria-label={label} className={selectCls} value={value} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Not staff</option>
      {current && !manages(me, current) && <option value={current.id}>{current.name}</option>}
      {roles
        .filter((r) => manages(me, r))
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
    </select>
  );
}

// ---- Staff members ---------------------------------------------------------

interface StaffMember {
  id: string;
  username: string;
  discriminator: string;
  displayName: string;
  avatarUrl: string | null;
  role: StaffRole;
}

function AddStaffDialog({ me, roles, onClose, onSaved }: { me: ConsoleMe; roles: StaffRole[]; onClose: () => void; onSaved: () => void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<any[]>([]);
  const [pick, setPick] = useState<any | null>(null);
  const offered = roles.filter((r) => manages(me, r));
  const [roleId, setRoleId] = useState(offered[offered.length - 1]?.id ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!query.trim()) return setFound([]);
    const t = setTimeout(() => {
      void http.get<{ transmitters: any[] }>(`/console/transmitters?search=${encodeURIComponent(query.trim())}`).then(
        (r) => setFound(r.transmitters.filter((u) => !u.staffRank && !u.staffRoleId).slice(0, 8)),
        () => setFound([])
      );
    }, 200);
    return () => clearTimeout(t);
  }, [query]);
  const save = async () => {
    if (!pick || !roleId) return;
    setBusy(true);
    try {
      await http.patch(`/console/transmitters/${pick.id}/staff-role`, { roleId });
      toast(`${pick.displayName || pick.username} is now ${roles.find((r) => r.id === roleId)?.name}.`, 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title="Add Staff Member" maxWidth="md">
      <div className="space-y-4">
        {pick ? (
          <div className="flex items-center gap-3 rounded-lg bg-raised p-3">
            <Avatar user={pick} size={36} decoration={false} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-fg">{pick.displayName || pick.username}</p>
              <p className="truncate text-xs text-fg-muted">
                {pick.username}#{pick.discriminator}
              </p>
            </div>
            <Button variant="link" className="text-fg" onClick={() => setPick(null)}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <label className="flex h-9 items-center gap-2 rounded-md bg-void px-3">
              <Search className="h-4 w-4 text-fg-subtle" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by username or display name" aria-label="Find a transmitter" className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
            </label>
            <ul aria-label="Matching transmitters" className="max-h-60 space-y-1 overflow-y-auto">
              {found.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => setPick(u)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                    <Avatar user={u} size={28} decoration={false} />
                    <span className="truncate text-sm font-medium text-fg">{u.displayName || u.username}</span>
                    <span className="truncate text-xs text-fg-muted">
                      {u.username}#{u.discriminator}
                    </span>
                  </button>
                </li>
              ))}
              {query.trim() && !found.length && <li className="px-2 py-3 text-sm text-fg-muted">Nobody who is not already staff matches.</li>}
            </ul>
          </>
        )}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase text-fg-muted">Rank</span>
          <select aria-label="Rank to give" className={clsx(selectCls, 'h-9 w-full')} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {offered.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} isLoading={busy} disabled={!pick || !roleId}>
            Add to Staff
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function StaffTab({ me }: { me: ConsoleMe }) {
  const { roles, reload: reloadRoles } = useStaffRoles();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [adding, setAdding] = useState(false);
  const meId = useStore((s) => s.me?.id);
  const load = () =>
    http
      .get<{ staff: StaffMember[] }>('/console/staff')
      .then((r) => setStaff(r.staff))
      .catch((err) => toast((err as Error).message, 'error'));
  useEffect(() => {
    void load();
  }, []);
  const manageStaff = can(me, 'MANAGE_STAFF');
  const change = async (u: StaffMember, roleId: string | null) => {
    const go = async () => {
      await http.patch(`/console/transmitters/${u.id}/staff-role`, { roleId });
      toast(roleId ? `${u.displayName || u.username} is now ${roles?.find((r) => r.id === roleId)?.name}.` : `${u.displayName || u.username} is no longer staff.`, 'success');
      await Promise.all([load(), reloadRoles()]);
    };
    if (roleId) return go().catch((err) => toast((err as Error).message, 'error'));
    confirmAction({
      title: 'Remove from Staff',
      body: `${u.displayName || u.username} loses the ${u.role.name} rank and every console permission.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: go,
    });
  };
  return (
    <SettingsSection title="Staff" description="Everyone who can open the Command Console, highest rank first.">
      {manageStaff && roles && (
        <Button size="sm" className="mb-4" onClick={() => setAdding(true)}>
          <span className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> Add Staff Member
          </span>
        </Button>
      )}
      {staff === null || roles === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : (
        <ul aria-label="Staff members" className="space-y-2">
          {staff.map((u) => {
            const editable = manageStaff && u.id !== meId && (me.role.isRoot || u.role.position < me.position);
            return (
              <li key={u.id} aria-label={u.displayName || u.username} className="flex items-center gap-3 rounded-lg bg-raised p-3">
                <Avatar user={u} size={36} decoration={false} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-fg">{u.displayName || u.username}</span>
                    <RankPill role={u.role} />
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    {u.username}#{u.discriminator}
                  </p>
                </div>
                {editable && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <RankSelect me={me} roles={roles} value={u.role.id} label={`Staff rank for ${u.username}`} onChange={(id) => void change(u, id)} />
                    <button type="button" aria-label={`Remove ${u.username} from staff`} onClick={() => void change(u, null)} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-danger hover:text-white">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding && roles && <AddStaffDialog me={me} roles={roles} onClose={() => setAdding(false)} onSaved={() => void Promise.all([load(), reloadRoles()])} />}
    </SettingsSection>
  );
}

// ---- Staff ranks -----------------------------------------------------------

function RankDialog({ me, role, badges, onClose, onSaved }: { me: ConsoleMe; role: StaffRole | null; badges: CustomBadge[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(role?.name ?? '');
  const [color, setColor] = useState(role?.color ?? '#3B8EF2');
  const [permissions, setPermissions] = useState(role?.permissions ?? STAFF_PERMISSIONS.VIEW_REPORTS);
  const [badgeId, setBadgeId] = useState(role?.badgeId ?? '');
  const [busy, setBusy] = useState(false);
  const locked = !!role?.isRoot;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: name.trim(), color, badgeId: badgeId || null, ...(locked ? {} : { permissions }) };
      if (role) await http.patch(`/console/staff-roles/${role.id}`, body);
      else await http.post('/console/staff-roles', body);
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const rankBadges = badges.filter((b) => b.criteriaType === 'staff_role');
  return (
    <Modal isOpen onClose={onClose} title={role ? `Edit ${role.name}` : 'Create Staff Rank'} maxWidth="lg">
      <form onSubmit={save} className="space-y-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required autoFocus />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase text-fg-muted">Color</span>
            <input type="color" aria-label="Rank color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-md bg-void p-1 ring-1 ring-line" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase text-fg-muted">Badge</span>
          <select aria-label="Rank badge" className={clsx(selectCls, 'h-9 w-full')} value={badgeId} onChange={(e) => setBadgeId(e.target.value)}>
            <option value="">The standard Staff badge</option>
            {rankBadges.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-fg-subtle">Shown on every holder's profile. Make one under Badges ("Worn by a staff rank").</span>
        </label>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase text-fg-muted">Permissions</legend>
          {locked && <p className="mb-2 text-sm text-fg-muted">Root always has every permission.</p>}
          <div className="space-y-1">
            {STAFF_PERMISSION_INFO.map((p) => {
              const bit = STAFF_PERMISSIONS[p.key];
              const mine = me.role.isRoot || (me.permissions & bit) !== 0;
              return (
                <label key={p.key} className={clsx('flex items-start gap-3 rounded-md px-2 py-2', locked || !mine ? 'opacity-60' : 'cursor-pointer hover:bg-hover')}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
                    checked={locked || (permissions & bit) !== 0}
                    disabled={locked || !mine}
                    onChange={(e) => setPermissions((v) => (e.target.checked ? v | bit : v & ~bit))}
                  />
                  <span>
                    <span className="block text-sm font-medium text-fg">{p.label}</span>
                    <span className="block text-xs text-fg-muted">{p.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!name.trim()}>
            {role ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function StaffRanksTab({ me }: { me: ConsoleMe }) {
  const { roles, reload } = useStaffRoles();
  const [badges, setBadges] = useState<CustomBadge[]>([]);
  const [editing, setEditing] = useState<StaffRole | 'new' | null>(null);
  useEffect(() => {
    void http.get<{ badges: CustomBadge[] }>('/console/badges').then((r) => setBadges(r.badges), () => {});
  }, []);
  const movable = (roles ?? []).filter((r) => !r.isRoot && manages(me, r) && r.id !== me.role.id);
  const move = async (role: StaffRole, by: -1 | 1) => {
    const ids = movable.map((r) => r.id);
    const i = ids.indexOf(role.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await http.put('/console/staff-roles/order', { ids });
      await reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const remove = (r: StaffRole) =>
    confirmAction({
      title: `Delete ${r.name}`,
      body: r.members ? `${r.members} ${r.members === 1 ? 'person loses' : 'people lose'} this rank and leave staff.` : 'Nobody holds this rank.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/console/staff-roles/${r.id}`);
        await reload();
      },
    });
  return (
    <SettingsSection title="Staff Ranks" description="Higher ranks outrank lower ones: staff act only on accounts and ranks below their own.">
      <Button size="sm" className="mb-4" onClick={() => setEditing('new')}>
        <span className="flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Create Rank
        </span>
      </Button>
      {roles === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : (
        <ul aria-label="Staff ranks" className="space-y-2">
          {roles.map((r) => {
            const editable = manages(me, r);
            const at = movable.findIndex((m) => m.id === r.id);
            const perms = STAFF_PERMISSION_INFO.filter((p) => (r.permissions & STAFF_PERMISSIONS[p.key]) !== 0);
            const badge = badges.find((b) => b.id === r.badgeId);
            return (
              <li key={r.id} aria-label={r.name} className="flex items-center gap-3 rounded-lg bg-raised p-3">
                <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <RankPill role={r} />
                    <span className="text-xs text-fg-muted">
                      {r.members} {r.members === 1 ? 'member' : 'members'}
                    </span>
                    {badge && <img src={badge.iconUrl} alt="" className="h-4 w-4 [image-rendering:pixelated]" title={`Badge: ${badge.name}`} />}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg-subtle">{r.isRoot ? 'Every permission' : perms.length ? perms.map((p) => p.label).join(' · ') : 'Can look up transmitters only'}</p>
                </div>
                {at >= 0 && (
                  <div className="flex shrink-0">
                    <button type="button" aria-label={`Move ${r.name} up`} disabled={at === 0} onClick={() => void move(r, -1)} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={`Move ${r.name} down`} disabled={at === movable.length - 1} onClick={() => void move(r, 1)} className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {editable && (
                  <RowButton onClick={() => setEditing(r)}>
                    <span className="flex items-center gap-1.5">
                      <Pencil className="h-4 w-4" /> Edit
                    </span>
                  </RowButton>
                )}
                {editable && !r.isRoot && (
                  <button type="button" aria-label={`Delete ${r.name}`} onClick={() => remove(r)} className="grid h-9 w-9 place-items-center rounded-md text-fg-muted hover:bg-danger hover:text-white">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <RankDialog me={me} role={editing === 'new' ? null : editing} badges={badges} onClose={() => setEditing(null)} onSaved={() => void reload()} />}
    </SettingsSection>
  );
}
