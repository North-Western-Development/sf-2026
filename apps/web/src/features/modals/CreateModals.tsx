import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { ChevronRight, Hash, Image as ImageIcon, MessagesSquare, Search, Volume2, Check, Copy, Users, Lock } from 'lucide-react';
import { Button, Input, Modal } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore, setState, getState } from '../../data/store';
import { acceptInvite, createBeacon, openDirectLink, sendMessage } from '../../data/actions';
import { http } from '../../lib/http';
import { toRelay, toMesh, userTag } from '../../lib/normalize';
import { channelKey, type RelayKind, type UserRef } from '../../lib/types';
import { term } from '../../lib/strings';
import { closeModal, toast } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { copyText } from '../../lib/clipboard';

// ---------------------------------------------------------------------------
// Create / join beacon
// ---------------------------------------------------------------------------

/** The built-in starters (the server's BUILTIN_TEMPLATES). */
const TEMPLATES = [
  { id: 'gaming', label: 'Gaming', icon: '🎮' },
  { id: 'school-club', label: 'School Club', icon: '🏫' },
  { id: 'study-group', label: 'Study Group', icon: '📚' },
  { id: 'friends', label: 'Friends', icon: '💖' },
  { id: 'artists-creators', label: 'Artists & Creators', icon: '🎨' },
  { id: 'local-community', label: 'Local Community', icon: '🏘️' },
];

export function CreateBeaconModal() {
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const [step, setStep] = useState<'start' | 'create' | 'join'>('start');
  const [template, setTemplate] = useState<string | undefined>(undefined);
  const [name, setName] = useState(`${me?.displayName || me?.username}'s ${term('beacon').toLowerCase()}`);
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const id = await createBeacon(name.trim(), null, template ? { template } : {});
      closeModal();
      navigate(`/channels/${id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const code = invite.trim().split('/').filter(Boolean).pop() ?? '';
    if (!code) return;
    setBusy(true);
    try {
      const id = await acceptInvite(code);
      closeModal();
      navigate(`/channels/${id}`);
    } catch (err) {
      setError((err as Error).message || 'That invite is invalid or expired.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'create')
    return (
      <Modal isOpen onClose={closeModal} title={`Customize your ${term('beacon')}`} description={`Give your new ${term('beacon').toLowerCase()} a personality with a name. You can change it later.`} maxWidth="md">
        <form onSubmit={create}>
          <Input label={`${term('beacon')} name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus error={error ?? undefined} />
          <p className="mt-2 text-xs text-fg-subtle">By creating a {term('beacon').toLowerCase()}, you agree to the Subspace Directives.</p>
          <div className="-mx-6 -mb-4 mt-6 flex justify-between bg-raised px-6 py-4">
            <Button
              variant="link"
              className="text-fg"
              onClick={() => {
                setTemplate(undefined);
                setStep('start');
              }}
            >
              Back
            </Button>
            <Button type="submit" isLoading={busy} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    );

  if (step === 'join')
    return (
      <Modal isOpen onClose={closeModal} title={`Join a ${term('beacon')}`} description="Enter an invite below to join an existing beacon." maxWidth="md">
        <form onSubmit={join}>
          <Input label="Invite link" placeholder="https://subspace.example/invite/hTKzmak" value={invite} onChange={(e) => setInvite(e.target.value)} required autoFocus error={error ?? undefined} />
          <p className="mt-3 text-xs font-semibold uppercase text-fg-muted">Invites look like</p>
          <p className="text-sm text-fg-muted">hTKzmak · {window.location.origin}/invite/hTKzmak</p>
          <div className="-mx-6 -mb-4 mt-6 flex justify-between bg-raised px-6 py-4">
            <Button variant="link" className="text-fg" onClick={() => setStep('start')}>
              Back
            </Button>
            <Button type="submit" isLoading={busy} disabled={!invite.trim()}>
              Join {term('beacon')}
            </Button>
          </div>
        </form>
      </Modal>
    );

  return (
    <Modal isOpen onClose={closeModal} title={`Create Your ${term('beacon')}`} description={`Your ${term('beacon').toLowerCase()} is where you and your crew hang out. Make yours and start transmitting.`} maxWidth="md">
      <button type="button" onClick={() => setStep('create')} className="flex w-full items-center gap-3 rounded-lg border border-line-strong p-3 text-left font-semibold text-fg hover:bg-hover">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-2xl">🛰️</span>
        <span className="flex-1">Create My Own</span>
        <ChevronRight className="h-5 w-5" />
      </button>
      <p className="mb-2 mt-4 text-xs font-bold uppercase text-fg-muted">Start from a template</p>
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            setTemplate(t.id);
            setStep('create');
          }}
          className="mb-2 flex w-full items-center gap-3 rounded-lg border border-line-strong p-3 text-left font-semibold text-fg hover:bg-hover"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-xl">{t.icon}</span>
          <span className="flex-1">{t.label}</span>
          <ChevronRight className="h-5 w-5" />
        </button>
      ))}
      <div className="-mx-6 -mb-4 mt-4 bg-raised px-6 py-4 text-center">
        <p className="text-lg font-semibold text-fg">Have an invite already?</p>
        <Button variant="secondary" fullWidth className="mt-2" onClick={() => setStep('join')}>
          Join a {term('beacon')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create relay / band
// ---------------------------------------------------------------------------

const RELAY_TYPES: Array<{ type: RelayKind; icon: React.ReactNode; label: string; description: string }> = [
  { type: 'text', icon: <Hash className="h-6 w-6" />, label: term('textRelay'), description: 'Send transmissions, images, GIFs, emoji, opinions, and puns' },
  { type: 'comm_link', icon: <Volume2 className="h-6 w-6" />, label: term('commLink'), description: 'Hang out together with voice, video, and Holo-Cast' },
  { type: 'archival', icon: <MessagesSquare className="h-6 w-6" />, label: term('archival'), description: 'Create a space for organized discussions' },
  { type: 'visual', icon: <ImageIcon className="h-6 w-6" />, label: term('visual'), description: 'Share photos, videos, and art in a gallery' },
];

async function createRelay(beaconId: string, body: Record<string, unknown>) {
  const res = await http.post<{ relay: any }>(`/beacons/${beaconId}/relays`, body);
  const relay = toRelay(res.relay);
  setState((s) => ({
    relays: { ...s.relays, [relay.id]: relay },
    relayIdsByBeacon: { ...s.relayIdsByBeacon, [beaconId]: [...(s.relayIdsByBeacon[beaconId] ?? []).filter((x) => x !== relay.id), relay.id] },
  }));
  return relay;
}

export function CreateRelayModal({ beaconId, parentId, type: initialType }: { beaconId: string; parentId?: string | null; type?: string }) {
  const navigate = useNavigate();
  const [type, setType] = useState<RelayKind>((initialType as RelayKind) ?? 'text');
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const band = useStore((s) => (parentId ? s.relays[parentId] : undefined));
  const normalized = type === 'text' ? name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '') : name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalized.trim()) return;
    setBusy(true);
    try {
      const siblings = Object.values(getState().relays).filter((r) => r.beaconId === beaconId && r.parentId === (parentId ?? null));
      const relay = await createRelay(beaconId, { name: normalized.trim(), type, parentId: parentId ?? null, position: siblings.length });
      if (isPrivate) {
        const everyone = getState().clearances[beaconId]?.find((c) => c.position === 0);
        if (everyone) await http.put(`/beacons/${beaconId}/relays/${relay.id}/overwrites/${everyone.id}`, { targetType: 'clearance', allow: '0', deny: '1' }).catch(() => toast('Relay created, but it could not be made private yet.', 'error'));
      }
      closeModal();
      navigate(`/channels/${beaconId}/${relay.id}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={closeModal} title={`Create ${term('relay')}`} description={band ? `in ${band.name}` : undefined} maxWidth="lg">
      <form onSubmit={submit}>
        <p className="mb-2 text-xs font-bold uppercase text-fg-muted">{term('relay')} type</p>
        <div role="radiogroup" className="space-y-2">
          {RELAY_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              role="radio"
              aria-checked={type === t.type}
              onClick={() => setType(t.type)}
              className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left', type === t.type ? 'bg-active' : 'bg-raised hover:bg-hover')}
            >
              <span className="text-fg-muted">{t.icon}</span>
              <span className="flex-1">
                <span className="block font-medium text-fg">{t.label}</span>
                <span className="block text-sm text-fg-muted">{t.description}</span>
              </span>
              <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full border-2', type === t.type ? 'border-brand bg-brand' : 'border-fg-subtle')}>
                {type === t.type && <span className="h-2 w-2 rounded-full bg-white" />}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-5">
          <Input label={`${term('relay')} name`} placeholder={type === 'text' ? 'new-relay' : 'New Relay'} value={type === 'text' ? normalized : name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus required />
        </div>
        <label className="mt-5 flex cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="flex items-center gap-1.5 font-medium text-fg">
              <Lock className="h-4 w-4" /> Private {term('relay')}
            </span>
            <span className="block text-sm text-fg-muted">Only selected transmitters and {term('clearance', true).toLowerCase()} can view this relay.</span>
          </span>
          <input type="checkbox" role="switch" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="h-5 w-9 accent-[var(--color-brand)]" />
        </label>
        <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
          <Button variant="link" className="text-fg" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!normalized.trim()}>
            Create {term('relay')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateBandModal({ beaconId }: { beaconId: string }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const bands = Object.values(getState().relays).filter((r) => r.beaconId === beaconId && r.type === 'category');
      await createRelay(beaconId, { name: name.trim(), type: 'category', position: bands.length });
      closeModal();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={closeModal} title={`Create ${term('band')}`} maxWidth="md">
      <form onSubmit={submit}>
        <Input label={`${term('band')} name`} placeholder="New Band" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus required />
        <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
          <Button variant="link" className="text-fg" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!name.trim()}>
            Create {term('band')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

const EXPIRY = [
  { label: '30 minutes', seconds: 1800 },
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '12 hours', seconds: 43200 },
  { label: '1 day', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: 'Never', seconds: 0 },
];

export function InviteModal({ beaconId, relayId }: { beaconId: string; relayId?: string }) {
  const beacon = useStore((s) => s.beacons[beaconId]);
  const relay = useStore((s) => (relayId ? s.relays[relayId] : undefined));
  const friends = useStore(useShallow((s) => Object.values(s.relationships).filter((r) => r.type === 'friend').map((r) => r.user)));
  const [maxAge, setMaxAge] = useState(604800);
  const [maxUses, setMaxUses] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setCode(null);
    setError(null);
    http
      .post<{ invite: { code: string } }>(`/beacons/${beaconId}/invites`, { relayId, maxAgeSeconds: maxAge, maxUses })
      .then((r) => setCode(r.invite.code))
      .catch((err) => setError((err as Error).message));
  }, [beaconId, relayId, maxAge, maxUses]);

  const url = code ? `${window.location.origin}/invite/${code}` : '';
  const shown = friends.filter((f) => !query || f.username.includes(query.toLowerCase()) || (f.displayName ?? '').toLowerCase().includes(query.toLowerCase()));

  const sendTo = async (u: UserRef) => {
    if (!url) return;
    try {
      const linkId = await openDirectLink(u.id);
      await sendMessage(channelKey('link', linkId), url);
      setSent((s) => ({ ...s, [u.id]: true }));
    } catch {
      toast('Could not send invite', 'error');
    }
  };

  return (
    <Modal isOpen onClose={closeModal} title={`Invite ${term('affiliate', true).toLowerCase()} to ${beacon?.name}`} description={relay ? `Recipients will land in #${relay.name}` : undefined} maxWidth="lg">
      <label className="mb-3 flex h-9 items-center gap-2 rounded-md bg-void px-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search for ${term('affiliate', true).toLowerCase()}`} className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle" />
        <Search className="h-4 w-4 text-fg-subtle" />
      </label>
      <div className="max-h-56 overflow-y-auto border-b border-line pb-3">
        {shown.length === 0 && <p className="py-4 text-center text-sm text-fg-subtle">No {term('affiliate', true).toLowerCase()} to invite.</p>}
        {shown.map((u) => (
          <div key={u.id} className="flex h-11 items-center gap-3 rounded-md px-2 hover:bg-hover">
            <Avatar user={u} size={32} />
            <span className="min-w-0 flex-1 truncate text-fg">{u.displayName || u.username}</span>
            <Button size="sm" variant={sent[u.id] ? 'ghost' : 'outline'} disabled={sent[u.id] || !code} onClick={() => void sendTo(u)}>
              {sent[u.id] ? 'Sent' : 'Invite'}
            </Button>
          </div>
        ))}
      </div>
      <p className="mb-2 mt-4 text-xs font-bold uppercase text-fg-muted">Or, send a {term('beacon').toLowerCase()} invite link</p>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <div className="flex items-center rounded-md bg-void pr-1">
          <input readOnly value={url || 'Generating…'} aria-label="Invite link" className="h-10 flex-1 bg-transparent px-3 text-sm text-fg outline-none" onFocus={(e) => e.currentTarget.select()} />
          <Button
            size="sm"
            disabled={!url}
            onClick={() => {
              void copyText(url, 'Invite link copied');
            }}
          >
            <Copy className="h-4 w-4" /> Copy
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-fg-subtle">
        Your invite link expires in {EXPIRY.find((e) => e.seconds === maxAge)?.label.toLowerCase()}
        {maxUses ? ` after ${maxUses} uses` : ''}.{' '}
        <button className="text-brand-sky hover:underline" onClick={() => setEditing((v) => !v)}>
          Edit invite link.
        </button>
      </p>
      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs font-bold uppercase text-fg-muted">
            Expire after
            <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} className="mt-1 block h-9 w-full rounded-md border border-line bg-void px-2 text-sm normal-case text-fg">
              {EXPIRY.map((e) => (
                <option key={e.seconds} value={e.seconds}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold uppercase text-fg-muted">
            Max number of uses
            <select value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className="mt-1 block h-9 w-full rounded-md border border-line bg-void px-2 text-sm normal-case text-fg">
              {[0, 1, 5, 10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'No limit' : `${n} use${n === 1 ? '' : 's'}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create mesh (group link)
// ---------------------------------------------------------------------------

export function CreateMeshModal() {
  const navigate = useNavigate();
  const friends = useStore(useShallow((s) => Object.values(s.relationships).filter((r) => r.type === 'friend').map((r) => r.user)));
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = useMemo(
    () => friends.filter((f) => !query || f.username.includes(query.toLowerCase()) || (f.displayName ?? '').toLowerCase().includes(query.toLowerCase())),
    [friends, query]
  );
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 9 ? s : [...s, id]));

  const create = async () => {
    setBusy(true);
    try {
      if (selected.length === 1) {
        const id = await openDirectLink(selected[0]);
        closeModal();
        navigate(`/channels/@me/${id}`);
        return;
      }
      const names = friends.filter((f) => selected.includes(f.id)).map((f) => f.displayName || f.username);
      const res = await http.post<{ mesh: any }>('/meshes', { name: names.join(', ').slice(0, 100), memberIds: selected });
      const mesh = toMesh({ ...res.mesh, members: friends.filter((f) => selected.includes(f.id)).concat(getState().me ? [getState().me!] : []) });
      setState((s) => ({ meshes: { ...s.meshes, [mesh.id]: mesh } }));
      closeModal();
      navigate(`/channels/@me/${mesh.id}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={closeModal} title={`Select ${term('affiliate', true)}`} description={`You can add ${9 - selected.length} more ${term('affiliate', true).toLowerCase()}.`} maxWidth="md">
      <label className="mb-3 flex h-9 items-center gap-2 rounded-md bg-void px-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type the username of an affiliate" className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle" autoFocus />
      </label>
      <div className="max-h-72 overflow-y-auto">
        {shown.length === 0 && (
          <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-fg-subtle">
            <Users className="h-8 w-8" /> No {term('affiliate', true).toLowerCase()} found.
          </p>
        )}
        {shown.map((f) => (
          <button key={f.id} type="button" onClick={() => toggle(f.id)} className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-hover">
            <Avatar user={f} size={32} showPresence />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-fg">{f.displayName || f.username}</span>
              <span className="block truncate text-xs text-fg-subtle">{userTag(f)}</span>
            </span>
            <span className={clsx('flex h-5 w-5 items-center justify-center rounded-xs border', selected.includes(f.id) ? 'border-brand bg-brand text-on-brand' : 'border-line-strong')}>
              {selected.includes(f.id) && <Check className="h-3.5 w-3.5" />}
            </span>
          </button>
        ))}
      </div>
      <div className="-mx-6 -mb-4 mt-4 bg-raised px-6 py-4">
        <Button fullWidth disabled={!selected.length} isLoading={busy} onClick={create}>
          {selected.length > 1 ? `Create ${term('mesh')}` : `Open ${term('link')}`}
        </Button>
      </div>
    </Modal>
  );
}
