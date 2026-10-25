import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { clsx } from 'clsx';
import { Check, ListChecks, Lock, Plus, Search } from 'lucide-react';
import { Button, Tooltip } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { setState, useStore } from '../../data/store';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { applySelections, loadRelayPrefs, setHiddenRelays, useCommunity } from '../../data/community';
import { openModal, toast } from '../../app/ui';
import { http, optional } from '../../lib/http';
import { formatAgo } from '../../lib/time';
import { term } from '../../lib/strings';
import type { Relay } from '../../lib/types';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { RelayIcon } from '../sidebar/BeaconSidebar';
import { MobileNavButton } from '../../app/mobile';

export interface OnboardingOption {
  id: string;
  label: string;
  description: string | null;
  emoji: string | null;
  clearanceIds: string[];
  relayIds: string[];
}
export interface OnboardingQuestion {
  id: string;
  title: string;
  multiple: boolean;
  required: boolean;
  options: OnboardingOption[];
}

/** Discord's Channels & Roles: answer the beacon's questions (Customize) and pick which relays you follow (Browse Channels). */
export function ChannelsRolesPage() {
  const { beaconId = '' } = useParams();
  const beacon = useStore((s) => s.beacons[beaconId]);
  const relayCount = useStore((s) => (s.relayIdsByBeacon[beaconId] ?? []).filter((id) => s.relays[id] && s.relays[id].type !== 'category').length);
  const [tab, setTab] = useState<'customize' | 'browse'>('customize');
  if (!beacon) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <MobileNavButton />
        <ListChecks className="h-5 w-5 text-fg-subtle" />
        <h1 className="font-semibold text-fg">Channels &amp; Roles</h1>
      </header>
      <nav aria-label="Channels and roles" className="flex shrink-0 gap-6 border-b border-line px-6">
        {(
          [
            ['customize', 'Customize', null],
            ['browse', 'Browse Channels', relayCount],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={clsx('flex items-center gap-1.5 border-b-2 py-3 text-sm font-medium', tab === id ? 'border-brand-sky text-brand-sky' : 'border-transparent text-fg-muted hover:text-fg')}
          >
            {label}
            {n !== null && <span className="rounded-full bg-overlay px-1.5 text-xs text-fg">{n}</span>}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">{tab === 'customize' ? <Customize beaconId={beaconId} /> : <Browse beaconId={beaconId} />}</div>
    </div>
  );
}

function Customize({ beaconId }: { beaconId: string }) {
  const [questions, setQuestions] = useState<OnboardingQuestion[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const perms = useStore((s) => beaconPermissions(s, beaconId));
  const me = useStore((s) => s.me);
  const member = useStore((s) => (me ? s.members[beaconId]?.[me.id] : undefined));
  const clearances = useStore(useShallow((s) => [...(s.clearances[beaconId] ?? [])].sort((a, b) => b.position - a.position)));

  useEffect(() => {
    void optional(http.get<{ questions: OnboardingQuestion[]; selectedOptionIds: string[] }>(`/beacons/${beaconId}/onboarding-questions`), { questions: [], selectedOptionIds: [] }).then((r) => {
      setQuestions(r.questions);
      setPicked(r.selectedOptionIds);
    });
  }, [beaconId]);

  const choose = async (q: OnboardingQuestion, optionId: string) => {
    const before = picked;
    const inQ = new Set(q.options.map((o) => o.id));
    const next = picked.includes(optionId) ? picked.filter((id) => id !== optionId) : q.multiple ? [...picked, optionId] : [...picked.filter((id) => !inQ.has(id)), optionId];
    setPicked(next);
    try {
      const res = await http.put<{ selectedOptionIds: string[]; hiddenRelayIds: string[]; clearanceIds: string[] }>(`/beacons/${beaconId}/onboarding-selections`, { optionIds: next });
      applySelections(beaconId, res);
      if (me)
        setState((s) => ({
          members: { ...s.members, [beaconId]: { ...s.members[beaconId], [me.id]: { ...s.members[beaconId][me.id], clearanceIds: res.clearanceIds } } },
        }));
    } catch (err) {
      setPicked(before);
      toast((err as Error).message, 'error');
    }
  };

  const held = clearances.filter((c) => member?.clearanceIds.includes(c.id) && c.position > 0);

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-fg">Customization Questions</h2>
        <p className="mb-4 text-sm text-fg-muted">Answer questions to get access to more {term('relay', true).toLowerCase()} and {term('clearance', true).toLowerCase()}.</p>
        {questions === null && <p className="text-sm text-fg-muted">Loading…</p>}
        {questions?.length === 0 && (
          <div className="rounded-xl bg-raised p-8 text-center ring-1 ring-line">
            <p className="font-semibold text-fg">No questions yet</p>
            <p className="mt-1 text-sm text-fg-muted">This {term('beacon').toLowerCase()} has not set up any customization questions.</p>
            {can(perms, PERMISSIONS.MANAGE_BEACON) && (
              <Button className="mt-4" onClick={() => openModal({ kind: 'beaconSettings', beaconId, tab: 'onboarding' })}>
                Set Up Questions
              </Button>
            )}
          </div>
        )}
        <div className="space-y-6">
          {questions?.map((q) => (
            <section key={q.id} aria-label={q.title} className="rounded-xl bg-raised p-4 ring-1 ring-line">
              <h3 className="mb-3 font-semibold text-fg">
                {q.title}
                {q.required && <span className="ml-1 text-danger">*</span>}
              </h3>
              <div role={q.multiple ? 'group' : 'radiogroup'} aria-label={q.title} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {q.options.map((o) => {
                  const on = picked.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={q.multiple ? 'checkbox' : 'radio'}
                      aria-checked={on}
                      onClick={() => void choose(q, o.id)}
                      className={clsx('relative flex min-h-[72px] items-center gap-3 rounded-lg px-4 py-3 text-left ring-1 transition-colors', on ? 'bg-brand/10 ring-brand' : 'bg-overlay ring-line hover:bg-hover')}
                    >
                      {o.emoji && <span className="text-2xl leading-none">{o.emoji}</span>}
                      <span className="min-w-0">
                        <span className="block font-medium text-fg">{o.label}</span>
                        {o.description && <span className="block text-xs text-fg-muted">{o.description}</span>}
                      </span>
                      {on && (
                        <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-on-brand">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-fg-subtle">{q.multiple ? 'Choose all that apply.' : 'Pick one.'}</p>
            </section>
          ))}
        </div>
      </div>

      {me && (
        <aside aria-label="My profile" className="w-full shrink-0 lg:w-72">
          <h2 className="text-base font-semibold text-fg">My Profile</h2>
          <p className="mb-4 text-sm text-fg-muted">This is how you'll look to others!</p>
          <Avatar user={me} src={member?.avatarUrl} size={80} />
          <UserName user={me} beaconId={beaconId} className="mt-2 block text-xl font-bold" />
          <hr className="my-4 border-line" />
          <h3 className="mb-2 text-xs font-semibold text-fg-muted">{term('clearance', true)}</h3>
          <div className="flex flex-wrap gap-1.5">
            {held.length === 0 && <span className="text-sm text-fg-subtle">None yet</span>}
            {held.map((c) => (
              <span key={c.id} className="flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-xs text-fg ring-1 ring-line">
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.name}
              </span>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

function Browse({ beaconId }: { beaconId: string }) {
  const all = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter((r): r is Relay => !!r && !r.isHidden)));
  const prefs = useCommunity((s) => s.prefs[beaconId]);
  const perms = useStore((s) => beaconPermissions(s, beaconId));
  const [query, setQuery] = useState('');
  useEffect(() => {
    void loadRelayPrefs(beaconId);
  }, [beaconId]);

  const hidden = useMemo(() => new Set(prefs?.hiddenRelayIds ?? []), [prefs]);
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const byPos = (a: Relay, b: Relay) => a.position - b.position;
    const bands = all.filter((r) => r.type === 'category').sort(byPos);
    const relays = all.filter((r) => r.type !== 'category' && (!q || r.name.toLowerCase().includes(q)));
    return [
      { band: null as Relay | null, relays: relays.filter((r) => !r.parentId || !bands.some((b) => b.id === r.parentId)).sort(byPos) },
      ...bands.map((band) => ({ band, relays: relays.filter((r) => r.parentId === band.id).sort(byPos) })),
    ].filter((g) => g.relays.length);
  }, [all, q]);

  const save = (next: Set<string>) => void setHiddenRelays(beaconId, [...next]).catch((err) => toast((err as Error).message, 'error'));
  const setShown = (ids: string[], shown: boolean) => {
    const next = new Set(hidden);
    for (const id of ids) {
      if (shown) next.delete(id);
      else next.add(id);
    }
    save(next);
  };

  return (
    <>
      <div className="mb-5 flex gap-2">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-md bg-void px-3 ring-1 ring-line focus-within:ring-brand-sky">
          <Search className="h-4 w-4 text-fg-subtle" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Channels" aria-label="Search channels" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
        </label>
        {can(perms, PERMISSIONS.MANAGE_RELAYS) && (
          <Button onClick={() => openModal({ kind: 'createRelay', beaconId })}>
            <Plus className="h-4 w-4" /> Create
          </Button>
        )}
      </div>
      <div className="space-y-6">
        {groups.map(({ band, relays }) => {
          const hideable = relays.filter((r) => !r.isUnhideable);
          const following = hideable.every((r) => !hidden.has(r.id));
          return (
            <section key={band?.id ?? 'none'} aria-label={band?.name ?? 'Other relays'}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-fg">{band?.name ?? 'Other'}</h3>
                {hideable.length > 0 && (
                  <label className="flex items-center gap-3 whitespace-nowrap text-sm font-medium text-fg">
                    Follow Category
                    <button
                      type="button"
                      role="switch"
                      aria-checked={following}
                      aria-label={`Follow ${band?.name ?? 'other relays'}`}
                      onClick={() => setShown(hideable.map((r) => r.id), !following)}
                      className={clsx('relative h-6 w-10 shrink-0 rounded-full transition-colors', following ? 'bg-brand' : 'bg-fg-disabled')}
                    >
                      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', following ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                  </label>
                )}
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line">
                {relays.map((r) => {
                  const at = prefs?.activity[r.id];
                  const box = (
                    <input
                      type="checkbox"
                      aria-label={`Show ${r.name}`}
                      checked={r.isUnhideable || !hidden.has(r.id)}
                      disabled={r.isUnhideable}
                      onChange={(e) => setShown([r.id], e.target.checked)}
                      className="h-5 w-5 accent-[var(--color-brand)] disabled:opacity-60"
                    />
                  );
                  return (
                    <li key={r.id} className="flex items-center gap-3 bg-raised px-4 py-3">
                      <RelayIcon type={r.type} className="h-5 w-5 shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-fg">{r.name}</span>
                        {at && <span className="block text-xs text-fg-subtle">Active {formatAgo(at)}</span>}
                      </span>
                      {r.isUnhideable ? (
                        <Tooltip content="Everyone follows this one">
                          <span className="flex items-center gap-1.5">
                            <Lock className="h-3.5 w-3.5 text-fg-subtle" />
                            {box}
                          </span>
                        </Tooltip>
                      ) : (
                        box
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
