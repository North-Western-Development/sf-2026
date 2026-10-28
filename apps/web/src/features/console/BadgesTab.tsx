import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Award, ImagePlus, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { Button, Input, Modal } from '@subspace/ui';
import { http } from '../../lib/http';
import { pickImage, uploadMedia } from '../../lib/media';
import { confirmAction, toast } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { RowButton, SettingsSection } from '../settings/SettingsLayout';
import { BADGE_RULE_LABELS, describeBadgeRule, type CustomBadge } from './consoleData';

const selectCls = 'h-9 w-full rounded-md bg-void px-2 text-sm text-fg outline-none ring-1 ring-line focus:ring-brand';

function BadgeIcon({ badge, size = 32 }: { badge: Pick<CustomBadge, 'iconUrl' | 'name'>; size?: number }) {
  return <img src={badge.iconUrl} alt="" width={size} height={size} className="shrink-0 rounded [image-rendering:pixelated]" style={{ width: size, height: size }} />;
}

function BadgeDialog({ badge, onClose, onSaved }: { badge: CustomBadge | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(badge?.name ?? '');
  const [description, setDescription] = useState(badge?.description ?? '');
  const [iconUrl, setIconUrl] = useState(badge?.iconUrl ?? '');
  const [criteriaType, setCriteria] = useState<CustomBadge['criteriaType']>(badge?.criteriaType ?? 'manual');
  const [threshold, setThreshold] = useState(String(badge?.threshold || 30));
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const unit = BADGE_RULE_LABELS[criteriaType].unit;
  const upload = async () => {
    const file = await pickImage();
    if (!file) return;
    setUploading(true);
    try {
      setIconUrl(await uploadMedia('badge', file));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim(), iconUrl, criteriaType, ...(unit ? { threshold: Number(threshold) } : {}) };
      if (badge) await http.patch(`/console/badges/${badge.id}`, body);
      else await http.post('/console/badges', body);
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title={badge ? `Edit ${badge.name}` : 'Create Badge'} maxWidth="md">
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void upload()}
            aria-label={iconUrl ? 'Change icon' : 'Upload icon'}
            className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-void ring-1 ring-line hover:ring-brand"
          >
            {iconUrl ? <img src={iconUrl} alt="" className="h-10 w-10 [image-rendering:pixelated]" /> : <ImagePlus className={clsx('h-6 w-6 text-fg-subtle', uploading && 'animate-pulse')} />}
          </button>
          <p className="text-xs text-fg-muted">A square PNG, GIF or WebP up to 256 KB. Badges show at 18 px on profiles, so keep it simple; pixel art scales cleanly.</p>
        </div>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required autoFocus />
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} required hint="Shown when someone hovers the badge." />
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase text-fg-muted">How it is earned</span>
          <select aria-label="How it is earned" className={selectCls} value={criteriaType} onChange={(e) => setCriteria(e.target.value as CustomBadge['criteriaType'])}>
            {(Object.keys(BADGE_RULE_LABELS) as CustomBadge['criteriaType'][]).map((k) => (
              <option key={k} value={k}>
                {BADGE_RULE_LABELS[k].label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-fg-subtle">
            {criteriaType === 'manual'
              ? 'Staff give and take it from the Transmitters page or here.'
              : criteriaType === 'staff_role'
                ? 'Pick it for a rank under Staff Ranks; everyone holding that rank wears it.'
                : 'Everyone who reaches the threshold gets it the next time their profile is viewed.'}
          </span>
        </label>
        {unit && <Input label={`Threshold (${unit})`} type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} required />}
        <div className="flex justify-end gap-2">
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!name.trim() || !description.trim() || !iconUrl || uploading || (!!unit && Number(threshold) < 1)}>
            {badge ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Who holds a badge; hand-awarded ones can be given and taken here. */
function HoldersDialog({ badge, onClose, onChanged }: { badge: CustomBadge; onClose: () => void; onChanged: () => void }) {
  const [holders, setHolders] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<any[]>([]);
  const manual = badge.criteriaType === 'manual';
  const load = () => http.get<{ holders: any[] }>(`/console/badges/${badge.id}/holders`).then((r) => setHolders(r.holders), () => setHolders([]));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!manual || !query.trim()) return setFound([]);
    const t = setTimeout(() => {
      void http.get<{ transmitters: any[] }>(`/console/transmitters?search=${encodeURIComponent(query.trim())}`).then((r) => setFound(r.transmitters.slice(0, 6)), () => setFound([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query, manual]);
  const award = async (u: any) => {
    try {
      await http.post(`/console/badges/${badge.id}/holders`, { transmitterId: u.id });
      toast(`${u.displayName || u.username} has the ${badge.name} badge.`, 'success');
      setQuery('');
      await load();
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const revoke = async (u: any) => {
    try {
      await http.delete(`/console/badges/${badge.id}/holders/${u.id}`);
      await load();
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const held = new Set((holders ?? []).map((h) => h.id));
  return (
    <Modal isOpen onClose={onClose} title={`${badge.name} holders`} maxWidth="md">
      <div className="space-y-4">
        {manual ? (
          <div>
            <label className="flex h-9 items-center gap-2 rounded-md bg-void px-3">
              <Search className="h-4 w-4 text-fg-subtle" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Give it to…" aria-label="Find someone to give the badge" className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
            </label>
            {found.length > 0 && (
              <ul aria-label="Matching transmitters" className="mt-1 space-y-1">
                {found.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                    <Avatar user={u} size={28} decoration={false} />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                      {u.displayName || u.username} <span className="text-xs text-fg-muted">{u.username}#{u.discriminator}</span>
                    </span>
                    {held.has(u.id) ? <span className="text-xs text-fg-subtle">Has it</span> : <RowButton onClick={() => void award(u)}>Give</RowButton>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{describeBadgeRule(badge)}: given and taken automatically.</p>
        )}
        {holders === null ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : holders.length === 0 ? (
          <p className="py-4 text-center text-sm text-fg-muted">Nobody has this badge yet.</p>
        ) : (
          <ul aria-label="Badge holders" className="max-h-72 space-y-1 overflow-y-auto">
            {holders.map((u) => (
              <li key={u.id} aria-label={u.displayName || u.username} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                <Avatar user={u} size={28} decoration={false} />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {u.displayName || u.username} <span className="text-xs text-fg-muted">{u.username}#{u.discriminator}</span>
                </span>
                {manual && (
                  <button type="button" onClick={() => void revoke(u)} className="h-8 rounded-md px-3 text-sm font-medium text-danger hover:bg-danger hover:text-white">
                    Take away
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function BadgesTab() {
  const [badges, setBadges] = useState<CustomBadge[] | null>(null);
  const [editing, setEditing] = useState<CustomBadge | 'new' | null>(null);
  const [holdersOf, setHoldersOf] = useState<CustomBadge | null>(null);
  const load = () =>
    http
      .get<{ badges: CustomBadge[] }>('/console/badges')
      .then((r) => setBadges(r.badges))
      .catch((err) => toast((err as Error).message, 'error'));
  useEffect(() => {
    void load();
  }, []);
  const remove = (b: CustomBadge) =>
    confirmAction({
      title: `Delete ${b.name}`,
      body: `${b.holders ? `${b.holders} ${b.holders === 1 ? 'person loses' : 'people lose'} it.` : 'Nobody has it yet.'} This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/console/badges/${b.id}`);
        await load();
      },
    });
  return (
    <SettingsSection title="Badges" description="Your own badges, next to the built-in ones on profiles: given by staff, worn by a staff rank, or earned by a rule.">
      <Button size="sm" className="mb-4" onClick={() => setEditing('new')}>
        <span className="flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Create Badge
        </span>
      </Button>
      {badges === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : badges.length === 0 ? (
        <div className="py-12 text-center">
          <Award className="mx-auto h-10 w-10 text-fg-subtle" />
          <p className="mt-3 font-semibold text-fg">No custom badges yet</p>
          <p className="mt-1 text-sm text-fg-muted">Create one to recognise contributors, events or staff ranks.</p>
        </div>
      ) : (
        <ul aria-label="Custom badges" className="space-y-2">
          {badges.map((b) => (
            <li key={b.id} aria-label={b.name} className="flex items-center gap-3 rounded-lg bg-raised p-3">
              <BadgeIcon badge={b} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{b.name}</p>
                <p className="truncate text-xs text-fg-muted">{b.description}</p>
                <p className="truncate text-xs text-fg-subtle">
                  {describeBadgeRule(b)} · {b.holders} {b.holders === 1 ? 'holder' : 'holders'}
                </p>
              </div>
              <RowButton onClick={() => setHoldersOf(b)}>
                <span className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" /> Holders
                </span>
              </RowButton>
              <button type="button" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)} className="grid h-9 w-9 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" aria-label={`Delete ${b.name}`} onClick={() => remove(b)} className="grid h-9 w-9 place-items-center rounded-md text-fg-muted hover:bg-danger hover:text-white">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <BadgeDialog badge={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
      {holdersOf && <HoldersDialog badge={holdersOf} onClose={() => setHoldersOf(null)} onChanged={() => void load()} />}
    </SettingsSection>
  );
}

/** From the Transmitters page: tick the hand-awarded badges someone has. */
export function TransmitterBadgesDialog({ user, onClose }: { user: { id: string; username: string; displayName?: string }; onClose: () => void }) {
  const [badges, setBadges] = useState<Array<CustomBadge & { held: boolean }> | null>(null);
  const load = () => http.get<{ badges: Array<CustomBadge & { held: boolean }> }>(`/console/transmitters/${user.id}/badges`).then((r) => setBadges(r.badges), () => setBadges([]));
  useEffect(() => {
    void load();
  }, []);
  const toggle = async (b: CustomBadge & { held: boolean }) => {
    try {
      if (b.held) await http.delete(`/console/badges/${b.id}/holders/${user.id}`);
      else await http.post(`/console/badges/${b.id}/holders`, { transmitterId: user.id });
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Badges for ${user.displayName || user.username}`} maxWidth="md">
      {badges === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : badges.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">There are no hand-awarded badges yet. Create one on the Badges page.</p>
      ) : (
        <ul aria-label="Hand-awarded badges" className="space-y-1">
          {badges.map((b) => (
            <li key={b.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={b.held} onChange={() => void toggle(b)} aria-label={b.name} />
                <BadgeIcon badge={b} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{b.name}</span>
                  <span className="block truncate text-xs text-fg-muted">{b.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
