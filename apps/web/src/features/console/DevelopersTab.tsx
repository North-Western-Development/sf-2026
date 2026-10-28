import { useEffect, useState } from 'react';
import { Button } from '@subspace/ui';
import { PRIVILEGED_INTENTS, PRIVILEGED_INTENT_INFO, verifiedMeans, type DeveloperAudience, type DeveloperPolicy, type VerificationMethod } from '@subspace/constants';
import { http } from '../../lib/http';
import { toast } from '../../app/ui';
import { SettingsSection } from '../settings/SettingsLayout';

const METHODS: Array<{ key: VerificationMethod; label: string; hint: string }> = [
  { key: 'email', label: 'Verified email', hint: 'They confirmed their email address.' },
  { key: 'phone', label: 'Verified phone number', hint: 'They confirmed a mobile number by text message.' },
  { key: 'staff', label: 'Verified by staff', hint: 'Someone with Manage developers verified them in Transmitters.' },
];

function Radio({ name, value, current, label, onChange }: { name: string; value: DeveloperAudience; current: DeveloperAudience; label: string; onChange: (v: DeveloperAudience) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-fg">
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} />
      {label}
    </label>
  );
}

/**
 * Command Console › Developers: who may create applications and turn on privileged bot intents,
 * and what counts as a verified account for them.
 */
export function DevelopersTab() {
  const [policy, setPolicy] = useState<DeveloperPolicy | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    http.get<{ policy: DeveloperPolicy }>('/console/developer-policy').then(
      (r) => {
        setPolicy(r.policy);
        setSaved(JSON.stringify(r.policy));
      },
      (err) => toast((err as Error).message, 'error')
    );
  }, []);
  if (!policy) return <p className="text-sm text-fg-muted">Loading…</p>;

  const set = (patch: Partial<DeveloperPolicy>) => setPolicy({ ...policy, ...patch });
  const toggle = <T,>(list: T[], item: T, on: boolean) => (on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item));
  const dirty = JSON.stringify(policy) !== saved;
  const save = async () => {
    setBusy(true);
    try {
      const r = await http.put<{ policy: DeveloperPolicy }>('/console/developer-policy', policy);
      setPolicy(r.policy);
      setSaved(JSON.stringify(r.policy));
      toast('Developer policy saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Developers"
      description="Who may build on this instance: Developer Applications (sign-in with Subspace, bots and Rich Presence) and the privileged bot intents. Bots that are already running lose an intent as soon as their developer no longer qualifies."
    >
      <fieldset aria-label="Verified accounts" className="rounded-lg bg-raised p-4">
        <legend className="sr-only">Verified accounts</legend>
        <p className="text-sm font-semibold text-fg">What makes an account verified</p>
        <p className="mb-2 text-xs text-fg-muted">Any one of these is enough.</p>
        {METHODS.map((m) => (
          <label key={m.key} className="mt-2 flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={policy.verifiedBy.includes(m.key)}
              // At least one way to be verified.
              disabled={policy.verifiedBy.length === 1 && policy.verifiedBy[0] === m.key}
              onChange={(e) => set({ verifiedBy: toggle(policy.verifiedBy, m.key, e.target.checked) })}
            />
            <span>
              <span className="block text-sm font-medium text-fg">{m.label}</span>
              <span className="block text-xs text-fg-subtle">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset aria-label="Creating applications" className="mt-4 rounded-lg bg-raised p-4">
        <legend className="sr-only">Creating applications</legend>
        <p className="mb-2 text-sm font-semibold text-fg">Who can create applications</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Radio name="createApps" value="everyone" current={policy.createApps} label="Anyone" onChange={(v) => set({ createApps: v })} />
          <Radio name="createApps" value="verified" current={policy.createApps} label="Verified accounts" onChange={(v) => set({ createApps: v })} />
        </div>
        <p className="mb-1 mt-4 text-sm font-semibold text-fg">Always required</p>
        {(['email', 'phone'] as const).map((m) => (
          <label key={m} className="mt-1 flex items-center gap-3 text-sm text-fg">
            <input type="checkbox" checked={policy.createAppsRequires.includes(m)} onChange={(e) => set({ createAppsRequires: toggle(policy.createAppsRequires, m, e.target.checked) })} />
            {m === 'email' ? 'A verified email' : 'A verified phone number'}
          </label>
        ))}
      </fieldset>

      <fieldset aria-label="Privileged intents" className="mt-4 rounded-lg bg-raised p-4">
        <legend className="sr-only">Privileged intents</legend>
        <p className="text-sm font-semibold text-fg">Privileged intents</p>
        <p className="mb-2 text-xs text-fg-muted">Who may turn each one on for their bots.</p>
        {PRIVILEGED_INTENTS.map((intent) => (
          <div key={intent} role="radiogroup" aria-label={PRIVILEGED_INTENT_INFO[intent].label} className="mt-3">
            <p className="text-sm font-medium text-fg">{PRIVILEGED_INTENT_INFO[intent].label}</p>
            <p className="mb-1 text-xs text-fg-subtle">{PRIVILEGED_INTENT_INFO[intent].description}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Radio name={`intent-${intent}`} value="everyone" current={policy.intents[intent]} label="Any developer" onChange={(v) => set({ intents: { ...policy.intents, [intent]: v } })} />
              <Radio name={`intent-${intent}`} value="verified" current={policy.intents[intent]} label="Verified developers" onChange={(v) => set({ intents: { ...policy.intents, [intent]: v } })} />
            </div>
          </div>
        ))}
      </fieldset>

      <p className="mt-4 text-xs text-fg-muted">Verified here means {verifiedMeans(policy)}.</p>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => void save()} disabled={!dirty || busy}>
          Save Changes
        </Button>
        {dirty && (
          <Button variant="link" className="text-fg" onClick={() => setPolicy(JSON.parse(saved))}>
            Reset
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
