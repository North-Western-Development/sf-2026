import { useEffect, useState } from 'react';
import { AtSign, Ban, BookX, ChevronDown, ListX, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Input } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../data/store';
import { http } from '../../../lib/http';
import { term } from '../../../lib/strings';
import { confirmAction, toast } from '../../../app/ui';
import { Dropdown } from '../../common/Dropdown';
import { RelayIcon } from '../../sidebar/BeaconSidebar';
import { SettingsTitle, Switch, Field } from '../SettingsLayout';

export interface Rule {
  id: string;
  name: string;
  trigger: 'keyword' | 'preset' | 'mention_spam' | 'spam';
  keywords: string[];
  regexes: string[];
  allowList: string[];
  presets: string[];
  mentionLimit: number;
  blockMessage: boolean;
  customMessage: string | null;
  alertChannelId: string | null;
  timeoutSeconds: number;
  exemptClearanceIds: string[];
  exemptRelayIds: string[];
  enabled: boolean;
}

const KINDS = [
  { trigger: 'mention_spam', title: 'Block Mention Spam', blurb: 'Block transmissions with too many mentions.', icon: <AtSign /> },
  { trigger: 'spam', title: 'Block Suspected Spam Content', blurb: 'The same transmission sent again within a minute, or one with lots of links.', icon: <Ban /> },
  { trigger: 'preset', title: 'Block Commonly Flagged Words', blurb: 'Built-in lists of profanity, insults and sexual content.', icon: <BookX /> },
  { trigger: 'keyword', title: 'Block Custom Words', blurb: 'Words, phrases and patterns you choose. Up to 6 rules.', icon: <ListX /> },
] as const;
const PRESET_LABELS: Record<string, string> = { profanity: 'Profanity', insults: 'Insults and Slurs', sexual: 'Sexual Content' };
const TIMEOUTS = [
  { value: '0', label: 'No timeout' },
  { value: '60', label: '60 seconds' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes' },
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '1 day' },
  { value: '604800', label: '1 week' },
];
const DEFAULTS: Record<string, Partial<Rule>> = {
  mention_spam: { name: 'Block Mention Spam', mentionLimit: 5 },
  spam: { name: 'Block Suspected Spam Content' },
  preset: { name: 'Block Commonly Flagged Words', presets: ['profanity'] },
  keyword: { name: 'Custom Words' },
};

const lines = (v: string) => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

function Checks({ label, options, chosen, onChange }: { label: string; options: Array<{ id: string; label: React.ReactNode }>; chosen: string[]; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-sm font-semibold text-fg">{label}</legend>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {options.map((o) => {
          const on = chosen.includes(o.id);
          return (
            <label key={o.id} className={clsx('flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm', on ? 'border-brand bg-brand/10 text-fg' : 'border-line text-fg-muted')}>
              <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--color-brand)]" checked={on} onChange={() => onChange(on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id])} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RuleEditor({ beaconId, rule, onSaved, onDeleted }: { beaconId: string; rule: Rule; onSaved: (r: Rule) => void; onDeleted: () => void }) {
  const [d, setD] = useState(rule);
  const [keywords, setKeywords] = useState(rule.keywords.join(', '));
  const [regexes, setRegexes] = useState(rule.regexes.join('\n'));
  const [allow, setAllow] = useState(rule.allowList.join(', '));
  const [saving, setSaving] = useState(false);
  const relays = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter((r) => r && r.type !== 'category')));
  const clearances = useStore(useShallow((s) => (s.clearances[beaconId] ?? []).filter((c) => c.position > 0)));
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body: Partial<Rule> = {
        name: d.name,
        blockMessage: d.blockMessage,
        customMessage: d.customMessage || null,
        alertChannelId: d.alertChannelId,
        timeoutSeconds: d.timeoutSeconds,
        exemptClearanceIds: d.exemptClearanceIds,
        exemptRelayIds: d.exemptRelayIds,
        allowList: lines(allow),
      };
      if (d.trigger === 'keyword') Object.assign(body, { keywords: lines(keywords), regexes: regexes.split('\n').map((x) => x.trim()).filter(Boolean) });
      if (d.trigger === 'preset') body.presets = d.presets;
      if (d.trigger === 'mention_spam') body.mentionLimit = d.mentionLimit;
      const res = await http.patch<{ rule: Rule }>(`/beacons/${beaconId}/automod/rules/${rule.id}`, body);
      onSaved(res.rule);
      toast('Rule saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-line px-4 pb-4 pt-3">
      {d.trigger === 'keyword' && (
        <>
          <Field label="Rule Name">
            <Input aria-label="Rule name" value={d.name} maxLength={100} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Blocked words" hint="Separate with commas. word* matches words starting with it, *word words ending with it, *word* anywhere.">
            <textarea aria-label="Blocked words" value={keywords} rows={3} onChange={(e) => setKeywords(e.target.value)} className="w-full rounded-md border border-line bg-void px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
          </Field>
          <Field label="Patterns (regex)" hint="One per line, up to 10.">
            <textarea aria-label="Patterns" value={regexes} rows={2} onChange={(e) => setRegexes(e.target.value)} className="w-full rounded-md border border-line bg-void px-3 py-2 font-mono text-sm text-fg outline-none focus:border-brand" />
          </Field>
        </>
      )}
      {d.trigger === 'preset' && (
        <Checks label="Word lists" options={Object.entries(PRESET_LABELS).map(([id, label]) => ({ id, label }))} chosen={d.presets} onChange={(v) => set('presets', v)} />
      )}
      {d.trigger === 'mention_spam' && (
        <Field label="Mention limit" hint="Transmissions with more unique mentions than this are stopped.">
          <Input aria-label="Mention limit" type="number" min={1} max={50} value={d.mentionLimit} onChange={(e) => set('mentionLimit', Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
        </Field>
      )}
      {(d.trigger === 'keyword' || d.trigger === 'preset') && (
        <Field label="Allowed words" hint="Never blocked by this rule, comma separated.">
          <Input aria-label="Allowed words" value={allow} onChange={(e) => setAllow(e.target.value)} />
        </Field>
      )}

      <p className="mb-2 text-sm font-semibold text-fg">Responses</p>
      <Switch label="Block transmission" description="Stops it posting and shows the author this message." checked={d.blockMessage} onChange={(v) => set('blockMessage', v)} />
      {d.blockMessage && (
        <Input aria-label="Custom block message" placeholder="Your transmission was blocked by AutoMod in this beacon." maxLength={150} value={d.customMessage ?? ''} onChange={(e) => set('customMessage', e.target.value)} />
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Dropdown
          label="Send an alert to"
          value={d.alertChannelId ?? 'none'}
          options={[{ value: 'none', label: 'No alert' }, ...relays.filter((r) => r.type === 'text').map((r) => ({ value: r.id, label: r.name, icon: <RelayIcon type={r.type} /> }))]}
          onChange={(v) => set('alertChannelId', v === 'none' ? null : v)}
        />
        <Dropdown label="Time out the author" value={String(d.timeoutSeconds)} options={TIMEOUTS} onChange={(v) => set('timeoutSeconds', Number(v))} />
      </div>

      <div className="mt-4">
        <Checks label={`Exempt ${term('clearance', true).toLowerCase()}`} options={clearances.map((c) => ({ id: c.id, label: c.name }))} chosen={d.exemptClearanceIds} onChange={(v) => set('exemptClearanceIds', v)} />
        <Checks
          label={`Exempt ${term('relay', true).toLowerCase()}`}
          options={relays.filter((r) => r.type === 'text' || r.type === 'archival').map((r) => ({ id: r.id, label: `#${r.name}` }))}
          chosen={d.exemptRelayIds}
          onChange={(v) => set('exemptRelayIds', v)}
        />
      </div>
      <div className="mt-2 flex justify-between">
        <Button
          variant="link"
          className="text-danger"
          onClick={() =>
            confirmAction({
              title: `Delete '${rule.name}'`,
              body: 'This rule stops checking transmissions right away.',
              confirmLabel: 'Delete Rule',
              danger: true,
              onConfirm: async () => {
                await http.delete(`/beacons/${beaconId}/automod/rules/${rule.id}`);
                onDeleted();
              },
            })
          }
        >
          <Trash2 className="mr-1 h-4 w-4" /> Delete Rule
        </Button>
        <Button onClick={() => void save()} isLoading={saving}>
          Save Rule
        </Button>
      </div>
    </div>
  );
}

/** Discord's AutoMod page: one card per kind of rule. */
export function AutoModTab({ beaconId }: { beaconId: string }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    http
      .get<{ rules: Rule[] }>(`/beacons/${beaconId}/automod/rules`)
      .then((r) => setRules(r.rules))
      .catch(() => setRules([]));
  }, [beaconId]);
  if (!rules) return <SettingsTitle>AutoMod</SettingsTitle>;

  const create = async (trigger: Rule['trigger']) => {
    try {
      const n = rules.filter((r) => r.trigger === 'keyword').length;
      const base = DEFAULTS[trigger];
      const res = await http.post<{ rule: Rule }>(`/beacons/${beaconId}/automod/rules`, { trigger, ...base, name: trigger === 'keyword' ? `Custom Words ${n + 1}` : base.name, enabled: true });
      setRules([...rules, res.rule]);
      setOpen(res.rule.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const toggle = async (rule: Rule, enabled: boolean) => {
    setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    await http.patch(`/beacons/${beaconId}/automod/rules/${rule.id}`, { enabled }).catch((e) => toast((e as Error).message, 'error'));
  };

  return (
    <>
      <SettingsTitle>AutoMod</SettingsTitle>
      <p className="-mt-4 mb-6 text-sm text-fg-muted">
        Keep your {term('beacon').toLowerCase()} clean with rules that stop transmissions before anyone sees them. Members who can manage the {term('beacon').toLowerCase()} are not affected.
      </p>
      <div className="space-y-4">
        {KINDS.map((k) => {
          const mine = rules.filter((r) => r.trigger === k.trigger);
          const canAdd = k.trigger === 'keyword' ? mine.length < 6 : mine.length === 0;
          return (
            <section key={k.trigger} aria-label={k.title} className="rounded-lg border border-line bg-raised">
              <div className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand-sky [&>svg]:h-5 [&>svg]:w-5">{k.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-fg">{k.title}</p>
                  <p className="text-sm text-fg-muted">{k.blurb}</p>
                </div>
                {canAdd && (
                  <Button size="sm" onClick={() => void create(k.trigger)}>
                    {k.trigger === 'keyword' && mine.length ? <Plus className="h-4 w-4" /> : 'Set Up'}
                  </Button>
                )}
              </div>
              {mine.map((r) => (
                <div key={r.id} className="border-t border-line">
                  <div className="flex items-center gap-3 px-4 py-2">
                    <button type="button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-fg">
                      <ChevronDown className={clsx('h-4 w-4 text-fg-muted transition-transform', open === r.id && 'rotate-180')} />
                      {r.name}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.enabled}
                      aria-label={`${r.name} enabled`}
                      onClick={() => void toggle(r, !r.enabled)}
                      className={clsx('relative h-6 w-10 shrink-0 rounded-full transition-colors', r.enabled ? 'bg-online' : 'bg-fg-disabled')}
                    >
                      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', r.enabled ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                  </div>
                  {open === r.id && (
                    <RuleEditor
                      beaconId={beaconId}
                      rule={r}
                      onSaved={(saved) => setRules(rules.map((x) => (x.id === saved.id ? saved : x)))}
                      onDeleted={() => setRules(rules.filter((x) => x.id !== r.id))}
                    />
                  )}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
