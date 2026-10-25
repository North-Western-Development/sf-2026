import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useStore, setState } from '../../../data/store';
import { http } from '../../../lib/http';
import { toBeacon } from '../../../lib/normalize';
import { term } from '../../../lib/strings';
import { formatFullDate } from '../../../lib/time';
import { toast } from '../../../app/ui';
import { Dropdown } from '../../common/Dropdown';
import { SettingsTitle, SettingsSection, RadioList, SaveBar, RowButton } from '../SettingsLayout';
import { useBeaconDraft } from './useBeaconDraft';

const LEVELS = [
  { value: 'none', label: 'None', description: 'Unrestricted.' },
  { value: 'low', label: 'Low', description: 'Must have a verified email on their account.' },
  { value: 'medium', label: 'Medium', description: 'Must also be registered on Subspace for longer than 5 minutes.' },
  { value: 'high', label: 'High', description: `Must also be a member of this ${term('beacon').toLowerCase()} for longer than 10 minutes.` },
  { value: 'highest', label: 'Highest', description: 'Must also have two-factor authentication turned on.' },
] as const;

const PAUSES = [
  { value: '1', label: '1 hour' },
  { value: '6', label: '6 hours' },
  { value: '12', label: '12 hours' },
  { value: '24', label: '24 hours' },
];

/** One of Discord's Security Actions: pause invites or DMs for up to a day. */
function PauseRow({ beaconId, field, title, description }: { beaconId: string; field: 'invitesPausedUntil' | 'dmsPausedUntil'; title: string; description: string }) {
  const until = useStore((s) => s.beacons[beaconId]?.[field]);
  const [hours, setHours] = useState('24');
  const active = !!until && new Date(until).getTime() > Date.now();
  const patch = async (value: string | null) => {
    try {
      const res = await http.patch<{ beacon: any }>(`/beacons/${beaconId}`, { [field]: value });
      setState((s) => ({ beacons: { ...s.beacons, [beaconId]: { ...s.beacons[beaconId], ...toBeacon(res.beacon) } } }));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="flex items-center gap-4 border-b border-line py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-sm text-fg-muted">{active ? `Paused until ${formatFullDate(until!)}.` : description}</p>
      </div>
      {active ? (
        <RowButton onClick={() => void patch(null)}>Resume</RowButton>
      ) : (
        <>
          <div className="w-36">
            <Dropdown hideLabel label={`${title} for`} value={hours} options={PAUSES} onChange={setHours} />
          </div>
          <RowButton danger onClick={() => void patch(new Date(Date.now() + Number(hours) * 3600_000).toISOString())}>
            Pause
          </RowButton>
        </>
      )}
    </div>
  );
}

/** Discord's Safety Setup: security actions for raids, and the verification level. */
export function SafetyTab({ beaconId, onOpenAutoMod }: { beaconId: string; onOpenAutoMod: () => void }) {
  const { d, set, dirty, saving, save, reset } = useBeaconDraft(beaconId, ['verificationLevel'] as const);
  return (
    <>
      <SettingsTitle>Safety Setup</SettingsTitle>
      <SettingsSection id="security-actions" title="Security Actions" description={`If a raid is underway, stop new people joining or DMing your members while you clean up.`}>
        <PauseRow beaconId={beaconId} field="invitesPausedUntil" title="Pause Invites" description={`No one can join this ${term('beacon').toLowerCase()} by invite or from Discover.`} />
        <PauseRow
          beaconId={beaconId}
          field="dmsPausedUntil"
          title="Pause Direct Links"
          description={`Members who are not affiliates cannot start or continue ${term('link', true).toLowerCase()} because they share this ${term('beacon').toLowerCase()}.`}
        />
      </SettingsSection>
      <SettingsSection
        id="verification"
        title="Verification Level"
        description={`Members must meet these criteria before they can send transmissions, react or speak. Members with a ${term('clearance').toLowerCase()} are exempt.`}
      >
        <RadioList label="Verification level" value={d.verificationLevel ?? 'none'} onChange={(v) => set('verificationLevel', v)} options={[...LEVELS]} />
      </SettingsSection>
      <SettingsSection id="automod" title="AutoMod">
        <div className="flex items-center gap-4">
          <ShieldAlert className="h-8 w-8 shrink-0 text-brand-sky" />
          <p className="flex-1 text-sm text-fg-muted">Block spam, mention floods and words you choose before anyone sees them.</p>
          <RowButton onClick={onOpenAutoMod}>Set Up AutoMod</RowButton>
        </div>
      </SettingsSection>
      <SaveBar visible={dirty} saving={saving} onReset={reset} onSave={() => void save()} />
    </>
  );
}
