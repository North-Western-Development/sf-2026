import { Emoji } from '../../../lib/emoji';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Smile, Trash2 } from 'lucide-react';
import { Button, Input, useContextMenu } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { PERMISSIONS } from '@subspace/constants';
import { useStore } from '../../../data/store';
import { toast } from '../../../app/ui';
import { http, optional } from '../../../lib/http';
import { term } from '../../../lib/strings';
import type { Relay } from '../../../lib/types';
import { EmojiPicker } from '../../chat/EmojiPicker';
import type { OnboardingQuestion } from '../../community/ChannelsRolesPage';
import { Switch } from '../SettingsLayout';

/** Mirrors the API's rule: answers may never hand out moderation or admin power. */
const ELEVATED =
  PERMISSIONS.ADMINISTRATOR |
  PERMISSIONS.MANAGE_BEACON |
  PERMISSIONS.MANAGE_RELAYS |
  PERMISSIONS.MANAGE_CLEARANCES |
  PERMISSIONS.MANAGE_TRANSMISSIONS |
  PERMISSIONS.MANAGE_NICKNAMES |
  PERMISSIONS.MANAGE_GLYPHS |
  PERMISSIONS.KICK_MEMBERS |
  PERMISSIONS.BAN_MEMBERS |
  PERMISSIONS.MUTE_MEMBERS |
  PERMISSIONS.MOVE_MEMBERS |
  PERMISSIONS.MENTION_EVERYONE;

type Draft = Omit<OnboardingQuestion, 'id' | 'options'> & { key: string; options: Array<Omit<OnboardingQuestion['options'][number], 'id'> & { key: string }> };
let seq = 0;
const key = () => `k${++seq}`;
const blankOption = () => ({ key: key(), label: '', description: null, emoji: null, clearanceIds: [], relayIds: [] });

/** Editor for the Channels & Roles questions: each answer can grant clearances and show relays. */
export function OnboardingQuestionsEditor({ beaconId }: { beaconId: string }) {
  const clearances = useStore(useShallow((s) => [...(s.clearances[beaconId] ?? [])].filter((c) => c.position > 0 && (BigInt(c.permissions ?? '0') & ELEVATED) === 0n).sort((a, b) => b.position - a.position)));
  const relays = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter((r): r is Relay => !!r && r.type !== 'category')));
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<{ rect: DOMRect; q: string; o: string } | null>(null);
  const { openContextMenu } = useContextMenu();

  useEffect(() => {
    void optional(http.get<{ questions: OnboardingQuestion[] }>(`/beacons/${beaconId}/onboarding-questions`), { questions: [] }).then((r) => {
      const d = r.questions.map((q) => ({ ...q, key: key(), options: q.options.map((o) => ({ ...o, key: key() })) }));
      setDrafts(d);
      setSaved(JSON.stringify(strip(d)));
    });
  }, [beaconId]);

  const strip = (d: Draft[]) => d.map(({ key: _k, ...q }) => ({ ...q, options: q.options.map(({ key: _o, ...o }) => o) }));
  const dirty = useMemo(() => drafts !== null && JSON.stringify(strip(drafts)) !== saved, [drafts, saved]);
  const patchQ = (qk: string, fn: (q: Draft) => Draft) => setDrafts((d) => d!.map((q) => (q.key === qk ? fn(q) : q)));
  const patchO = (qk: string, ok: string, fn: (o: Draft['options'][number]) => Draft['options'][number]) =>
    patchQ(qk, (q) => ({ ...q, options: q.options.map((o) => (o.key === ok ? fn(o) : o)) }));

  const pickFrom = (e: React.MouseEvent, all: Array<{ id: string; label: string }>, chosen: string[], onChange: (ids: string[]) => void) =>
    openContextMenu(
      { clientX: e.clientX, clientY: e.clientY },
      all.length
        ? all.map((x) => ({ label: x.label, checked: chosen.includes(x.id), onClick: () => onChange(chosen.includes(x.id) ? chosen.filter((y) => y !== x.id) : [...chosen, x.id]) }))
        : [{ label: 'Nothing to pick yet', disabled: true, onClick: () => {} }]
    );

  const save = async () => {
    setBusy(true);
    try {
      const res = await http.put<{ questions: OnboardingQuestion[] }>(`/beacons/${beaconId}/onboarding-questions`, { questions: strip(drafts!) });
      const d = res.questions.map((q) => ({ ...q, key: key(), options: q.options.map((o) => ({ ...o, key: key() })) }));
      setDrafts(d);
      setSaved(JSON.stringify(strip(d)));
      toast('Questions saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!drafts) return <p className="text-sm text-fg-muted">Loading questions…</p>;

  return (
    <section aria-label="Customization questions" className="mt-8">
      <h3 className="text-base font-semibold text-fg">Customization Questions</h3>
      <p className="mb-4 text-sm text-fg-muted">
        Members answer these in Channels &amp; Roles. Each answer can give {term('clearance', true).toLowerCase()} (only ones without moderation powers) and show {term('relay', true).toLowerCase()}.
      </p>
      <div className="space-y-4">
        {drafts.map((q, qi) => (
          <div key={q.key} className="rounded-lg bg-raised p-4 ring-1 ring-line">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input label={`Question ${qi + 1}`} value={q.title} maxLength={100} onChange={(e) => patchQ(q.key, (x) => ({ ...x, title: e.target.value }))} placeholder="What games do you want to play?" />
              </div>
              <button type="button" aria-label={`Delete question ${qi + 1}`} onClick={() => setDrafts((d) => d!.filter((x) => x.key !== q.key))} className="mb-1 flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-danger">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 grid gap-x-6 sm:grid-cols-2 [&>div]:py-2">
              <Switch label="Allow multiple answers" checked={q.multiple} onChange={(v) => patchQ(q.key, (x) => ({ ...x, multiple: v }))} />
              <Switch label="Required" checked={q.required} onChange={(v) => patchQ(q.key, (x) => ({ ...x, required: v }))} />
            </div>
            <ul className="mt-2 space-y-2" aria-label={`Answers to question ${qi + 1}`}>
              {q.options.map((o, oi) => (
                <li key={o.key} className="rounded-md bg-overlay p-2 ring-1 ring-line">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={o.emoji ? `Answer emoji ${o.emoji}` : `Pick an emoji for answer ${oi + 1}`}
                      onClick={(e) => setPicker({ rect: e.currentTarget.getBoundingClientRect(), q: q.key, o: o.key })}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-void text-xl text-fg-muted ring-1 ring-line hover:text-fg"
                    >
                      {o.emoji ? <Emoji emoji={o.emoji} size={22} /> : <Smile className="h-5 w-5" />}
                    </button>
                    <input value={o.label} maxLength={50} onChange={(e) => patchO(q.key, o.key, (x) => ({ ...x, label: e.target.value }))} placeholder="Answer" aria-label={`Answer ${oi + 1}`} className="h-9 min-w-0 flex-1 rounded-md bg-void px-2 text-sm text-fg outline-none ring-1 ring-line focus:ring-brand-sky" />
                    <input
                      value={o.description ?? ''}
                      maxLength={100}
                      onChange={(e) => patchO(q.key, o.key, (x) => ({ ...x, description: e.target.value || null }))}
                      placeholder="Description (optional)"
                      aria-label={`Answer ${oi + 1} description`}
                      className="hidden h-9 min-w-0 flex-1 rounded-md bg-void px-2 text-sm text-fg outline-none ring-1 ring-line focus:ring-brand-sky md:block"
                    />
                    <button type="button" aria-label={`Delete answer ${oi + 1}`} onClick={() => patchQ(q.key, (x) => ({ ...x, options: x.options.filter((y) => y.key !== o.key) }))} className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-danger">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 pl-11 text-xs">
                    <button
                      type="button"
                      onClick={(e) => pickFrom(e, clearances.map((c) => ({ id: c.id, label: c.name })), o.clearanceIds, (ids) => patchO(q.key, o.key, (x) => ({ ...x, clearanceIds: ids })))}
                      className="flex items-center gap-1 rounded-md bg-void px-2 py-1 text-fg-muted ring-1 ring-line hover:text-fg"
                    >
                      {o.clearanceIds.length ? clearances.filter((c) => o.clearanceIds.includes(c.id)).map((c) => c.name).join(', ') : `Give ${term('clearance', true).toLowerCase()}`}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => pickFrom(e, relays.map((r) => ({ id: r.id, label: r.name })), o.relayIds, (ids) => patchO(q.key, o.key, (x) => ({ ...x, relayIds: ids })))}
                      className="flex items-center gap-1 rounded-md bg-void px-2 py-1 text-fg-muted ring-1 ring-line hover:text-fg"
                    >
                      {o.relayIds.length ? relays.filter((r) => o.relayIds.includes(r.id)).map((r) => `#${r.name}`).join(', ') : `Show ${term('relay', true).toLowerCase()}`}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => patchQ(q.key, (x) => ({ ...x, options: [...x.options, blankOption()] }))}>
              <Plus className="h-4 w-4" /> Add answer
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={() => setDrafts((d) => [...d!, { key: key(), title: '', multiple: true, required: false, options: [blankOption()] }])}>
          <Plus className="h-4 w-4" /> Add Question
        </Button>
        <Button isLoading={busy} disabled={!dirty} onClick={() => void save()}>
          Save Questions
        </Button>
      </div>
      {picker && (
        <EmojiPicker
          anchor={picker.rect}
          glyphs="none"
          onClose={() => setPicker(null)}
          onPick={(emoji) => {
            patchO(picker.q, picker.o, (x) => ({ ...x, emoji }));
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}
