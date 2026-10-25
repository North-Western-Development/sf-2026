import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import {
  ChevronLeft,
  Hash,
  ArrowDown,
  ArrowUp,
  AudioLines,
  BarChart3,
  Bot,
  Copy,
  Flag,
  Gavel,
  Info,
  LayoutGrid,
  Link2,
  Plus,
  ScrollText,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smile,
  Sticker,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button, Input } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { hasPermission } from '@subspace/constants';
import { useStore, setState, getState } from '../../data/store';
import { loadBeacon } from '../../data/actions';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { http, optional } from '../../lib/http';
import { pickImage, uploadMedia } from '../../lib/media';
import { toBeacon, toClearance, toRelay, userTag } from '../../lib/normalize';
import { PERMISSION_GROUPS } from '../../lib/permissionMeta';
import { term } from '../../lib/strings';
import type { Clearance, Member } from '../../lib/types';
import { closeModal, confirmAction, toast } from '../../app/ui';
import { SettingsLayout, SettingsHeader, SettingsTitle, Field, Switch, SaveBar, useWideSettingsPage } from './SettingsLayout';
import { RelayIcon } from '../sidebar/BeaconSidebar';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { loadGlyphs, type Glyph } from '../chat/EmojiPicker';
import { RelaysTab } from './beacon/RelaysTab';
import { OnboardingQuestionsEditor } from './beacon/OnboardingQuestionsEditor';

// Stable fallbacks: a fresh {} / [] inside a selector would re-render forever.
const EMPTY_MEMBERS: Record<string, Member> = {};
const EMPTY_CLEARANCES: Clearance[] = [];

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab({ beaconId }: { beaconId: string }) {
  const beacon = useStore((s) => s.beacons[beaconId])!;
  const initial = useMemo(
    () => ({
      name: beacon.name,
      description: beacon.description ?? '',
      iconUrl: beacon.iconUrl,
      bannerUrl: beacon.bannerUrl,
      isDiscoverable: beacon.isDiscoverable,
      suppressCustomFonts: !!beacon.suppressCustomFonts,
    }),
    [beacon]
  );
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setD(initial), [initial]);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  const upload = async (purpose: 'beacon_icon' | 'beacon_banner', key: 'iconUrl' | 'bannerUrl') => {
    const file = await pickImage();
    if (!file) return;
    try {
      const url = await uploadMedia(purpose, file);
      setD((x) => ({ ...x, [key]: url }));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await http.patch<{ beacon: any }>(`/beacons/${beaconId}`, { ...d, description: d.description || null });
      setState((s) => ({ beacons: { ...s.beacons, [beaconId]: { ...s.beacons[beaconId], ...toBeacon(res.beacon) } } }));
      toast('Beacon updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsTitle>{term('beacon')} Overview</SettingsTitle>
      <div className="flex gap-8">
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={() => void upload('beacon_icon', 'iconUrl')} className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-overlay text-2xl font-bold hover:opacity-80" aria-label="Change icon">
            {d.iconUrl ? <img src={d.iconUrl} alt="" className="h-full w-full object-cover" /> : d.name[0]?.toUpperCase()}
          </button>
          {d.iconUrl && (
            <button className="text-xs text-fg-muted hover:underline" onClick={() => setD({ ...d, iconUrl: null })}>
              Remove
            </button>
          )}
          <p className="w-28 text-center text-xs text-fg-subtle">Minimum 128x128. PNG, JPEG, GIF or WebP.</p>
        </div>
        <div className="flex-1 space-y-4">
          <Field label={`${term('beacon')} Name`}>
            <Input aria-label={`${term('beacon')} Name`} value={d.name} maxLength={100} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <Field label="Description" hint="Shown in Discover and on invites.">
            <textarea value={d.description} maxLength={300} rows={3} onChange={(e) => setD({ ...d, description: e.target.value })} className="w-full resize-none rounded-md border border-line bg-void px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
          </Field>
        </div>
      </div>
      <Field label={`${term('beacon')} Banner`}>
        <div className="flex items-center gap-3">
          <div className="h-24 w-48 rounded-lg bg-overlay" style={d.bannerUrl ? { background: `center/cover url("${d.bannerUrl}")` } : undefined} />
          <Button size="sm" onClick={() => void upload('beacon_banner', 'bannerUrl')}>
            Upload Banner
          </Button>
          {d.bannerUrl && (
            <Button size="sm" variant="link" className="text-fg-muted" onClick={() => setD({ ...d, bannerUrl: null })}>
              Remove
            </Button>
          )}
        </div>
      </Field>
      <Switch label="Discoverable" description="List this beacon in Discover so anyone can find and join it." checked={d.isDiscoverable} onChange={(v) => setD({ ...d, isDiscoverable: v })} />
      <Switch label="Suppress custom display-name fonts" description="Members' custom fonts render in the default font inside this beacon." checked={d.suppressCustomFonts} onChange={(v) => setD({ ...d, suppressCustomFonts: v })} />
      <SaveBar visible={dirty} saving={saving} onReset={() => setD(initial)} onSave={() => void save()} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Clearances
// ---------------------------------------------------------------------------

const PRESET_COLORS = ['#3DCBFF', '#3B8EF2', '#3353D6', '#A78BFA', '#FF4D6A', '#FF9F43', '#FFF36B', '#3DDC84', '#99AAB5', '#5A5C8E'];

function PermissionToggle({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <Switch label={label} description={description} checked={checked} disabled={disabled} onChange={onChange} />;
}

function ClearancesTab({ beaconId }: { beaconId: string }) {
  useWideSettingsPage();
  const clearances = useStore(useShallow((s) => [...(s.clearances[beaconId] ?? [])].sort((a, b) => b.position - a.position)));
  const myPerms = useStore((s) => beaconPermissions(s, beaconId));
  const isOwner = useStore((s) => s.beacons[beaconId]?.ownerId === s.me?.id);
  const myTop = useStore((s) => {
    const me = s.me && s.members[beaconId]?.[s.me.id];
    return Math.max(0, ...(s.clearances[beaconId] ?? []).filter((c) => me?.clearanceIds.includes(c.id)).map((c) => c.position));
  });
  const members = useStore((s) => s.members[beaconId] ?? EMPTY_MEMBERS);
  const [selected, setSelected] = useState<string | null>(clearances[0]?.id ?? null);
  const [sub, setSub] = useState<'display' | 'permissions' | 'members'>('display');
  const current = clearances.find((c) => c.id === selected) ?? null;
  const [draft, setDraft] = useState<Clearance | null>(current);
  useEffect(() => setDraft(current), [current?.id, current]);
  const editable = !!current && (isOwner || current.position < myTop);
  const dirty = !!draft && !!current && JSON.stringify(draft) !== JSON.stringify(current);

  const upsert = (c: Clearance) => setState((s) => ({ clearances: { ...s.clearances, [beaconId]: [...(s.clearances[beaconId] ?? []).filter((x) => x.id !== c.id), c] } }));

  const create = async () => {
    try {
      const res = await http.post<{ clearance: any }>(`/beacons/${beaconId}/clearances`, { name: 'new clearance', color: '#99AAB5', permissions: '0', position: 1 });
      const c = toClearance(res.clearance);
      upsert(c);
      setSelected(c.id);
      setSub('display');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const save = async () => {
    if (!draft) return;
    try {
      const res = await http.patch<{ clearance: any }>(`/beacons/${beaconId}/clearances/${draft.id}`, {
        name: draft.name,
        color: draft.color,
        hoist: draft.hoist,
        permissions: draft.permissions,
        allowDelegation: draft.allowDelegation,
      });
      upsert(toClearance(res.clearance ?? draft));
      toast('Clearance saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const move = async (c: Clearance, dir: 1 | -1) => {
    const ordered = clearances.filter((x) => x.position > 0);
    const i = ordered.findIndex((x) => x.id === c.id);
    const other = ordered[i - dir];
    if (!other) return;
    try {
      await http.patch(`/beacons/${beaconId}/clearances/${c.id}`, { position: other.position });
      await http.patch(`/beacons/${beaconId}/clearances/${other.id}`, { position: c.position });
      upsert({ ...c, position: other.position });
      upsert({ ...other, position: c.position });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = (c: Clearance) =>
    confirmAction({
      title: `Delete '${c.name}'`,
      body: 'Are you sure you want to delete this clearance? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/beacons/${beaconId}/clearances/${c.id}`);
        setState((s) => ({ clearances: { ...s.clearances, [beaconId]: (s.clearances[beaconId] ?? []).filter((x) => x.id !== c.id) } }));
        setSelected(null);
      },
    });

  const bits = draft ? BigInt(draft.permissions) : 0n;
  const setBit = (bit: bigint, on: boolean) => draft && setDraft({ ...draft, permissions: String(on ? bits | bit : bits & ~bit) });

  return (
    <>
      <SettingsTitle>{term('clearance', true)}</SettingsTitle>
      <div className="flex gap-6">
        <div className="w-52 shrink-0">
          <Button size="sm" fullWidth className="mb-3" onClick={create} disabled={!can(myPerms, PERMISSIONS.MANAGE_CLEARANCES)}>
            <Plus className="h-4 w-4" /> Create {term('clearance')}
          </Button>
          <ul className="space-y-0.5">
            {clearances.map((c, i) => (
              <li key={c.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={clsx('flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm', selected === c.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover')}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="truncate">{c.position === 0 ? '@everyone' : c.name}</span>
                </button>
                {c.position > 0 && (
                  <span className="hidden gap-0.5 group-hover:flex">
                    <button aria-label="Move up" disabled={i === 0} onClick={() => void move(c, 1)} className="text-fg-subtle hover:text-fg disabled:opacity-30">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button aria-label="Move down" onClick={() => void move(c, -1)} className="text-fg-subtle hover:text-fg">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {draft && current && (
          <div className="min-w-0 flex-1">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase text-fg-muted">Edit {current.position === 0 ? '@everyone' : current.name}</h3>
              {current.position > 0 && editable && (
                <button aria-label="Delete clearance" onClick={() => remove(current)} className="text-fg-subtle hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            {!editable && <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-fg">You can only edit clearances below your highest clearance.</p>}
            <nav className="mb-5 flex gap-5 border-b border-line">
              {(['display', 'permissions', 'members'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setSub(t)} className={clsx('border-b-2 pb-2 text-sm font-medium capitalize', sub === t ? 'border-brand text-fg' : 'border-transparent text-fg-muted hover:text-fg')}>
                  {t === 'members' ? `Manage Members (${Object.values(members).filter((m) => current.position === 0 || m.clearanceIds.includes(current.id)).length})` : t}
                </button>
              ))}
            </nav>

            <fieldset disabled={!editable} className="disabled:opacity-60">
              {sub === 'display' && (
                <>
                  {current.position > 0 && <Field label={`${term('clearance')} Name`}>
            <Input aria-label={`${term('clearance')} Name`} value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>}
                  <Field label={`${term('clearance')} Color`} hint="Members use the color of their highest clearance.">
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {PRESET_COLORS.map((c) => (
                        <button key={c} type="button" aria-label={c} onClick={() => setDraft({ ...draft, color: c })} className={clsx('h-8 w-8 rounded-md', draft.color.toUpperCase() === c && 'ring-2 ring-fg ring-offset-2 ring-offset-base')} style={{ background: c }} />
                      ))}
                      <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })} aria-label="Custom color" className="h-8 w-12 cursor-pointer rounded-md border border-line bg-void" />
                    </div>
                  </Field>
                  {current.position > 0 && (
                    <>
                      <Switch label="Display members separately from online members" checked={draft.hoist} onChange={(v) => setDraft({ ...draft, hoist: v })} />
                      <Switch label="Allow members to assign this clearance to others below them" checked={!!draft.allowDelegation} onChange={(v) => setDraft({ ...draft, allowDelegation: v })} />
                    </>
                  )}
                </>
              )}
              {sub === 'permissions' &&
                PERMISSION_GROUPS.map((g) => (
                  <section key={g.title} className="mb-6">
                    <h4 className="mb-1 text-xs font-bold uppercase text-fg-muted">{g.title}</h4>
                    {g.items.map((perm) => (
                      <PermissionToggle
                        key={perm.key}
                        label={perm.label}
                        description={perm.description}
                        checked={(bits & perm.bit) === perm.bit}
                        // Cannot grant what you don't have (hierarchy protocol).
                        disabled={!isOwner && !hasPermission(myPerms, perm.bit)}
                        onChange={(v) => setBit(perm.bit, v)}
                      />
                    ))}
                  </section>
                ))}
            </fieldset>
            {sub === 'members' && (
              <ul className="space-y-1">
                {Object.values(members)
                  .filter((m) => current.position === 0 || m.clearanceIds.includes(current.id))
                  .map((m) => (
                    <li key={m.transmitterId} className="flex h-10 items-center gap-3 rounded-md px-2 hover:bg-hover">
                      <Avatar user={m.user} size={24} />
                      <UserName user={m.user} beaconId={beaconId} className="text-sm" styled={false} />
                      <span className="text-xs text-fg-subtle">{userTag(m.user)}</span>
                    </li>
                  ))}
              </ul>
            )}
            <SaveBar visible={dirty && editable} onReset={() => setDraft(current)} onSave={() => void save()} />
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Relay editing (+ permission overrides)
// ---------------------------------------------------------------------------

type Overwrite = { targetId: string; targetType: 'clearance' | 'transmitter'; allow: string; deny: string };

function RelayTab({ beaconId, relayId, onBack }: { beaconId: string; relayId: string; onBack: () => void }) {
  useWideSettingsPage();
  const navigate = useNavigate();
  const relay = useStore((s) => s.relays[relayId]);
  const clearances = useStore(useShallow((s) => [...(s.clearances[beaconId] ?? [])].sort((a, b) => b.position - a.position)));
  const members = useStore((s) => s.members[beaconId] ?? EMPTY_MEMBERS);
  const [d, setD] = useState({ name: relay?.name ?? '', topic: relay?.topic ?? '', isUnhideable: !!relay?.isUnhideable, isE2ee: !!relay?.isE2ee });
  const [overwrites, setOverwrites] = useState<Overwrite[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [sub, setSub] = useState<'overview' | 'permissions'>('overview');

  useEffect(() => {
    if (relay) setD({ name: relay.name, topic: relay.topic ?? '', isUnhideable: relay.isUnhideable, isE2ee: !!relay.isE2ee });
  }, [relay?.id]);
  useEffect(() => {
    void optional(http.get<{ overwrites: Overwrite[] }>(`/beacons/${beaconId}/relays/${relayId}/overwrites`), { overwrites: [] })
      .then((r) => setOverwrites(r.overwrites))
      .catch(() => setOverwrites([]));
  }, [beaconId, relayId]);

  if (!relay) return null;
  const dirty = d.name !== relay.name || d.topic !== (relay.topic ?? '') || d.isUnhideable !== relay.isUnhideable || d.isE2ee !== !!relay.isE2ee;
  const save = async () => {
    try {
      const res = await http.patch<{ relay: any }>(`/beacons/${beaconId}/relays/${relayId}`, {
        name: d.name,
        topic: d.topic || null,
        isUnhideable: d.isUnhideable,
        ...(relay.type === 'comm_link' ? { isE2ee: d.isE2ee } : {}),
      });
      setState((s) => ({ relays: { ...s.relays, [relayId]: { ...s.relays[relayId], ...toRelay(res.relay) } } }));
      toast('Relay saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const ow = overwrites?.find((o) => o.targetId === target);
  const setTri = async (bit: bigint, state: 'allow' | 'deny' | 'inherit') => {
    if (!target) return;
    const cur = ow ?? { targetId: target, targetType: clearances.some((c) => c.id === target) ? 'clearance' : 'transmitter', allow: '0', deny: '0' };
    let allow = BigInt(cur.allow) & ~bit;
    let deny = BigInt(cur.deny) & ~bit;
    if (state === 'allow') allow |= bit;
    if (state === 'deny') deny |= bit;
    const next = { ...cur, allow: String(allow), deny: String(deny) } as Overwrite;
    setOverwrites((list) => [...(list ?? []).filter((o) => o.targetId !== target), next]);
    await http
      .put(`/beacons/${beaconId}/relays/${relayId}/overwrites/${target}`, { targetType: next.targetType, allow: next.allow, deny: next.deny })
      .catch((err) => toast((err as Error).message, 'error'));
  };

  const targets = [
    ...clearances.map((c) => ({ id: c.id, label: c.position === 0 ? '@everyone' : c.name, color: c.color })),
    ...Object.values(members).map((m) => ({ id: m.transmitterId, label: userTag(m.user), color: undefined as string | undefined })),
  ].filter((t) => overwrites?.some((o) => o.targetId === t.id) || t.label === '@everyone');

  return (
    <>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ChevronLeft className="h-4 w-4" /> All {term('relay', true).toLowerCase()}
      </button>
      <SettingsTitle>
        <span className="flex items-center gap-2">
          <RelayIcon type={relay.type} className="h-5 w-5" /> {relay.name}
        </span>
      </SettingsTitle>
      <nav className="mb-5 flex gap-5 border-b border-line">
        {(['overview', 'permissions'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setSub(t)} className={clsx('border-b-2 pb-2 text-sm font-medium capitalize', sub === t ? 'border-brand text-fg' : 'border-transparent text-fg-muted hover:text-fg')}>
            {t}
          </button>
        ))}
      </nav>
      {sub === 'overview' ? (
        <>
          <Field label={`${term('relay')} Name`}>
            <Input aria-label={`${term('relay')} Name`} value={d.name} maxLength={100} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <div className="mt-4">
            <Field label={`${term('relay')} Topic`} hint="Supports markdown. Shown in the relay header.">
              <textarea value={d.topic} maxLength={1024} rows={3} onChange={(e) => setD({ ...d, topic: e.target.value })} className="w-full resize-none rounded-md border border-line bg-void px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
            </Field>
          </div>
          <Switch label="Core Priority Relay (unhideable)" description="Members cannot hide this relay from their relay list." checked={d.isUnhideable} onChange={(v) => setD({ ...d, isUnhideable: v })} />
          {relay.type === 'comm_link' && (
            <Switch
              label="End-to-end encrypt voice and video"
              description="Audio, video and screen share are encrypted on each device; the server relays only ciphertext. Everyone joining needs a browser that supports it."
              checked={d.isE2ee}
              onChange={(v) => setD({ ...d, isE2ee: v })}
            />
          )}
          <div className="mt-8">
            <Button
              variant="danger"
              onClick={() =>
                confirmAction({
                  title: `Delete ${term('relay')}`,
                  body: `Delete #${relay.name}? This cannot be undone.`,
                  confirmLabel: 'Delete',
                  danger: true,
                  onConfirm: async () => {
                    await http.delete(`/beacons/${beaconId}/relays/${relayId}`);
                    setState((s) => ({ relayIdsByBeacon: { ...s.relayIdsByBeacon, [beaconId]: (s.relayIdsByBeacon[beaconId] ?? []).filter((x) => x !== relayId) } }));
                    closeModal();
                    navigate(`/channels/${beaconId}`);
                  },
                })
              }
            >
              Delete {term('relay')}
            </Button>
          </div>
          <SaveBar visible={dirty} onReset={() => setD({ name: relay.name, topic: relay.topic ?? '', isUnhideable: relay.isUnhideable, isE2ee: !!relay.isE2ee })} onSave={() => void save()} />
        </>
      ) : (
        <div className="flex gap-6">
          <div className="w-52 shrink-0">
            <p className="mb-2 text-xs font-bold uppercase text-fg-muted">{term('clearance', true)} / Transmitters</p>
            <select
              value=""
              onChange={(e) => e.target.value && setTarget(e.target.value)}
              aria-label="Add override target"
              className="mb-2 h-8 w-full rounded-md border border-line bg-void px-1 text-sm text-fg"
            >
              <option value="">+ Add override…</option>
              {clearances
                .filter((c) => !overwrites?.some((o) => o.targetId === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.position === 0 ? '@everyone' : c.name}
                  </option>
                ))}
              {Object.values(members)
                .filter((m) => !overwrites?.some((o) => o.targetId === m.transmitterId))
                .map((m) => (
                  <option key={m.transmitterId} value={m.transmitterId}>
                    {userTag(m.user)}
                  </option>
                ))}
            </select>
            {targets.map((t) => (
              <button key={t.id} type="button" onClick={() => setTarget(t.id)} className={clsx('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm', target === t.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover')}>
                {t.color ? <span className="h-3 w-3 rounded-full" style={{ background: t.color }} /> : <Shield className="h-3 w-3" />}
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {!target ? (
              <p className="text-sm text-fg-muted">Select a clearance or transmitter to override permissions in this relay. ✓ allows, ✕ denies, / inherits.</p>
            ) : (
              PERMISSION_GROUPS.flatMap((g) => g.items)
                .filter((p) => p.relay)
                .map((p) => {
                  const state = ow && (BigInt(ow.allow) & p.bit) ? 'allow' : ow && (BigInt(ow.deny) & p.bit) ? 'deny' : 'inherit';
                  return (
                    <div key={p.key} className="flex items-center justify-between gap-4 border-b border-line py-3">
                      <div>
                        <p className="font-medium text-fg">{p.label}</p>
                        <p className="text-sm text-fg-muted">{p.description}</p>
                      </div>
                      <div className="flex overflow-hidden rounded-md border border-line-strong" role="radiogroup" aria-label={p.label}>
                        {(['deny', 'inherit', 'allow'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            role="radio"
                            aria-checked={state === st}
                            aria-label={st}
                            onClick={() => void setTri(p.bit, st)}
                            className={clsx(
                              'flex h-8 w-9 items-center justify-center text-sm font-bold',
                              state === st ? (st === 'allow' ? 'bg-online text-void' : st === 'deny' ? 'bg-danger text-white' : 'bg-active text-fg') : 'text-fg-subtle hover:bg-hover'
                            )}
                          >
                            {st === 'allow' ? '✓' : st === 'deny' ? '✕' : '/'}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Glyphs, members, invites, bans, onboarding
// ---------------------------------------------------------------------------

function GlyphsTab({ beaconId }: { beaconId: string }) {
  const [glyphs, setGlyphs] = useState<Glyph[] | null>(null);
  const reload = () => void loadGlyphs(beaconId).then(setGlyphs);
  useEffect(reload, [beaconId]);
  const add = async () => {
    const file = await pickImage();
    if (!file) return;
    try {
      const url = await uploadMedia('glyph', file);
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32).padEnd(2, '_');
      const res = await http.post<{ emoji: Glyph }>(`/beacons/${beaconId}/emojis`, { name, url });
      setGlyphs((g) => [...(g ?? []), res.emoji]);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <>
      <SettingsTitle>{term('glyph', true)}</SettingsTitle>
      <p className="mb-4 text-sm text-fg-muted">Add custom emoji anyone in this beacon can use. Names must be at least 2 characters (letters, numbers and underscores). Max 256 KB.</p>
      <Button onClick={add}>Upload {term('glyph')}</Button>
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-fg-subtle">
            <th className="py-2 font-semibold">Image</th>
            <th className="py-2 font-semibold">Name</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(glyphs ?? []).map((g) => (
            <tr key={g.id} className="border-t border-line">
              <td className="py-2">
                <img src={g.url} alt="" className="h-8 w-8 object-contain" />
              </td>
              <td>
                <input
                  defaultValue={g.name}
                  aria-label={`Rename ${g.name}`}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== g.name) void http.patch(`/beacons/${beaconId}/emojis/${g.id}`, { name }).catch((err) => toast(err.message, 'error'));
                  }}
                  className="h-8 rounded-md bg-transparent px-2 text-fg outline-none focus:bg-void"
                />
              </td>
              <td className="text-right">
                <button aria-label={`Delete ${g.name}`} onClick={() => void http.delete(`/beacons/${beaconId}/emojis/${g.id}`).then(() => setGlyphs((l) => (l ?? []).filter((x) => x.id !== g.id)))} className="text-fg-subtle hover:text-danger">
                  <X className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {glyphs?.length === 0 && <p className="py-6 text-center text-sm text-fg-subtle">No glyphs yet.</p>}
    </>
  );
}

function MembersTab({ beaconId }: { beaconId: string }) {
  useWideSettingsPage();
  const members = useStore(useShallow((s) => Object.values(s.members[beaconId] ?? {})));
  const clearances = useStore((s) => s.clearances[beaconId] ?? EMPTY_CLEARANCES);
  const [q, setQ] = useState('');
  const shown = members.filter((m) => !q || m.user.username.includes(q.toLowerCase()) || (m.nickname ?? '').toLowerCase().includes(q.toLowerCase()) || (m.user.displayName ?? '').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <SettingsTitle>Members</SettingsTitle>
      <label className="mb-4 flex h-9 items-center gap-2 rounded-md bg-void px-2">
        <Search className="h-4 w-4 text-fg-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username or nickname" className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle" />
      </label>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-fg-subtle">
            <th className="py-2 font-semibold">Name</th>
            <th className="py-2 font-semibold">Member Since</th>
            <th className="py-2 font-semibold">{term('clearance', true)}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.transmitterId} className="border-t border-line">
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <Avatar user={m.user} size={28} />
                  <span>
                    <UserName user={m.user} beaconId={beaconId} className="block font-medium" styled={false} />
                    <span className="text-xs text-fg-subtle">{userTag(m.user)}</span>
                  </span>
                </span>
              </td>
              <td className="text-fg-muted">{m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}</td>
              <td>
                <span className="flex flex-wrap gap-1">
                  {clearances
                    .filter((c) => m.clearanceIds.includes(c.id) && c.position > 0)
                    .map((c) => (
                      <span key={c.id} className="flex items-center gap-1 rounded-xs bg-raised px-1.5 text-xs text-fg">
                        <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                    ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-fg-subtle">Right-click a member anywhere to kick, ban, or change clearances.</p>
    </>
  );
}

function InvitesTab({ beaconId }: { beaconId: string }) {
  useWideSettingsPage();
  const [invites, setInvites] = useState<any[] | null>(null);
  useEffect(() => {
    void optional(http.get<{ invites: any[] }>(`/beacons/${beaconId}/invites`), { invites: [] })
      .then((r) => setInvites(r.invites))
      .catch(() => setInvites([]));
  }, [beaconId]);
  return (
    <>
      <SettingsTitle>Invites</SettingsTitle>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-fg-subtle">
            <th className="py-2 font-semibold">Inviter</th>
            <th className="py-2 font-semibold">Invite Code</th>
            <th className="py-2 font-semibold">Uses</th>
            <th className="py-2 font-semibold">Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(invites ?? []).map((inv) => (
            <tr key={inv.code} className="border-t border-line">
              <td className="py-2">
                {inv.inviter ? (
                  <span className="flex items-center gap-2">
                    <Avatar user={inv.inviter} size={24} />
                    <span className="text-fg">{inv.inviter.displayName || inv.inviter.username}</span>
                    <span className="text-xs text-fg-subtle">{userTag(inv.inviter)}</span>
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="font-mono text-fg">{inv.code}</td>
              <td className="text-fg-muted">
                {inv.uses}
                {inv.maxUses ? ` / ${inv.maxUses}` : ''}
              </td>
              <td className="text-fg-muted">{inv.expiresAt ? new Date(inv.expiresAt).toLocaleString() : 'Never'}</td>
              <td className="text-right">
                <button aria-label={`Revoke ${inv.code}`} onClick={() => void http.delete(`/invites/${inv.code}`).then(() => setInvites((l) => (l ?? []).filter((x) => x.code !== inv.code)))} className="text-fg-subtle hover:text-danger">
                  <X className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {invites?.length === 0 && <p className="py-6 text-center text-sm text-fg-subtle">No active invites.</p>}
    </>
  );
}

function BansTab({ beaconId }: { beaconId: string }) {
  useWideSettingsPage();
  const [bans, setBans] = useState<any[] | null>(null);
  useEffect(() => {
    void optional(http.get<{ bans: any[] }>(`/beacons/${beaconId}/bans`), { bans: [] })
      .then((r) => setBans(r.bans))
      .catch(() => setBans([]));
  }, [beaconId]);
  return (
    <>
      <SettingsTitle>Bans</SettingsTitle>
      {(bans ?? []).map((b) => (
        <div key={b.transmitterId ?? b.user?.id} className="flex items-center gap-3 border-t border-line py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-fg">{b.user ? userTag(b.user) : b.transmitterId}</span>
            {b.reason && <span className="block text-xs text-fg-subtle">Reason: {b.reason}</span>}
          </span>
          <Button size="sm" variant="outline" onClick={() => void http.delete(`/beacons/${beaconId}/bans/${b.transmitterId ?? b.user?.id}`).then(() => setBans((l) => (l ?? []).filter((x) => x !== b)))}>
            Revoke Ban
          </Button>
        </div>
      ))}
      {bans?.length === 0 && <p className="py-6 text-center text-sm text-fg-subtle">No bans. The frequency is clear.</p>}
    </>
  );
}

function OnboardingTab({ beaconId }: { beaconId: string }) {
  const beacon = useStore((s) => s.beacons[beaconId])!;
  const [rules, setRules] = useState(beacon.rulesText ?? '');
  const save = async () => {
    try {
      await http.patch(`/beacons/${beaconId}`, { rulesText: rules || null });
      setState((s) => ({ beacons: { ...s.beacons, [beaconId]: { ...s.beacons[beaconId], rulesText: rules || null } } }));
      toast('Onboarding saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <>
      <SettingsTitle>Onboarding</SettingsTitle>
      <Field label={`${term('beacon')} Rules`} hint="New members must accept these before transmitting. Markdown supported.">
        <textarea value={rules} rows={10} maxLength={4000} onChange={(e) => setRules(e.target.value)} className="w-full resize-y rounded-md border border-line bg-void px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
      </Field>
      <Button onClick={save} disabled={rules === (beacon.rulesText ?? '')}>
        Save Rules
      </Button>
      <OnboardingQuestionsEditor beaconId={beaconId} />
    </>
  );
}

// ---------------------------------------------------------------------------

export function BeaconSettings({ beaconId, tab: initialTab }: { beaconId: string; tab?: string }) {
  const navigate = useNavigate();
  const beacon = useStore((s) => s.beacons[beaconId]);
  const perms = useStore((s) => beaconPermissions(s, beaconId));
  const isOwner = useStore((s) => s.beacons[beaconId]?.ownerId === s.me?.id);
  const [tab, setTab] = useState(initialTab ?? 'overview');

  useEffect(() => {
    if (!getState().relayIdsByBeacon[beaconId]) void loadBeacon(beaconId);
  }, [beaconId]);
  if (!beacon) return null;

  const manageBeacon = can(perms, PERMISSIONS.MANAGE_BEACON);
  const manageRelays = can(perms, PERMISSIONS.MANAGE_RELAYS);

  return (
    <SettingsLayout
      title={`${beacon.name} Settings`}
      header={
        <SettingsHeader
          media={
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-overlay text-sm font-semibold text-fg">
              {beacon.iconUrl ? <img src={beacon.iconUrl} alt="" className="h-full w-full object-cover" /> : beacon.name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join('').toUpperCase()}
            </span>
          }
          name={beacon.name}
          action={<span className="block text-xs text-fg-subtle">{term('beacon')} Settings</span>}
        />
      }
      // A relay's own page sits under the Relays entry.
      active={tab.startsWith('relay:') ? 'relays' : tab}
      onSelect={setTab}
      onClose={closeModal}
      sections={[
        {
          heading: beacon.name,
          items: [
            ...(manageBeacon ? [{ id: 'overview', icon: <Info />, label: 'Overview' }] : []),
            ...(can(perms, PERMISSIONS.MANAGE_CLEARANCES) ? [{ id: 'clearances', icon: <ShieldCheck />, label: term('clearance', true) }] : []),
            ...(manageRelays ? [{ id: 'relays', icon: <Hash />, label: term('relay', true) }] : []),
            ...(can(perms, PERMISSIONS.MANAGE_GLYPHS) ? [{ id: 'glyphs', icon: <Smile />, label: term('glyph', true) }] : []),
            { id: 'stickers', icon: <Sticker />, label: 'Stickers', comingSoon: true },
            { id: 'soundboard', icon: <AudioLines />, label: 'Soundboard', comingSoon: true },
            { id: 'widget', icon: <LayoutGrid />, label: 'Widget', comingSoon: true },
          ],
        },
        {
          heading: 'People',
          items: [
            {
              id: 'members',
              icon: <Users />,
              label: 'Members',
              onClick: () => {
                closeModal();
                navigate(`/channels/${beaconId}/member-safety`);
              },
            },
            ...(can(perms, PERMISSIONS.CREATE_INVITES) ? [{ id: 'invites', icon: <Link2 />, label: 'Invites' }] : []),
            ...(can(perms, PERMISSIONS.BAN_MEMBERS) ? [{ id: 'bans', icon: <Gavel />, label: 'Bans' }] : []),
          ],
        },
        {
          heading: 'Moderation',
          items: [
            { id: 'automod', icon: <Bot />, label: 'AutoMod', comingSoon: true },
            { id: 'audit', icon: <ScrollText />, label: 'Audit Log', comingSoon: true },
            { id: 'safety', icon: <ShieldAlert />, label: 'Safety Setup', comingSoon: true },
          ],
        },
        {
          heading: 'Community',
          items: [
            ...(manageBeacon ? [{ id: 'onboarding', icon: <Flag />, label: 'Onboarding' }] : []),
            { id: 'insights', icon: <BarChart3 />, label: 'Beacon Insights', comingSoon: true },
            { id: 'template', icon: <Copy />, label: 'Beacon Template', comingSoon: true },
          ],
        },
        ...(isOwner
          ? [
              {
                items: [
                  {
                    id: 'delete',
                    icon: <Trash2 />,
                    label: `Delete ${term('beacon')}`,
                    danger: true,
                    onClick: () =>
                      confirmAction({
                        title: `Delete '${beacon.name}'`,
                        body: `Are you sure you want to delete ${beacon.name}? This action cannot be undone.`,
                        confirmLabel: `Delete ${term('beacon')}`,
                        danger: true,
                        onConfirm: async () => {
                          await http.delete(`/beacons/${beaconId}`);
                          setState((s) => {
                            const beacons = { ...s.beacons };
                            delete beacons[beaconId];
                            return { beacons, beaconOrder: s.beaconOrder.filter((x) => x !== beaconId) };
                          });
                          closeModal();
                          navigate('/channels/@me');
                        },
                      }),
                  },
                ],
              },
            ]
          : []),
      ]}
    >
      {tab === 'overview' && manageBeacon && <OverviewTab beaconId={beaconId} />}
      {tab === 'clearances' && <ClearancesTab beaconId={beaconId} />}
      {tab === 'glyphs' && <GlyphsTab beaconId={beaconId} />}
      {tab === 'relays' && <RelaysTab beaconId={beaconId} onOpen={(id) => setTab(`relay:${id}`)} />}
      {tab.startsWith('relay:') && <RelayTab key={tab} beaconId={beaconId} relayId={tab.slice(6)} onBack={() => setTab('relays')} />}
      {tab === 'members' && <MembersTab beaconId={beaconId} />}
      {tab === 'invites' && <InvitesTab beaconId={beaconId} />}
      {tab === 'bans' && <BansTab beaconId={beaconId} />}
      {tab === 'onboarding' && <OnboardingTab beaconId={beaconId} />}
    </SettingsLayout>
  );
}
