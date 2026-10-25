import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../data/store';
import { term } from '../../../lib/strings';
import { SettingsTitle, SettingsSection, Switch, RadioList, SaveBar } from '../SettingsLayout';
import { Dropdown } from '../../common/Dropdown';
import { RelayIcon } from '../../sidebar/BeaconSidebar';
import { useBeaconDraft } from './useBeaconDraft';

const KEYS = ['welcomeMessages', 'welcomeWave', 'setupTips', 'systemChannelId', 'defaultNotifications', 'afkChannelId', 'afkTimeout'] as const;
const TIMEOUTS = [
  { value: '60', label: '1 minute' },
  { value: '300', label: '5 minutes' },
  { value: '900', label: '15 minutes' },
  { value: '1800', label: '30 minutes' },
  { value: '3600', label: '1 hour' },
];

/** Discord's Engagement page: system messages, default notifications and the inactive comm-link. */
export function EngagementTab({ beaconId }: { beaconId: string }) {
  const { d, set, dirty, saving, save, reset } = useBeaconDraft(beaconId, KEYS);
  const memberCount = useStore((s) => s.beacons[beaconId]?.memberCount ?? 0);
  const relays = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter(Boolean)));
  const option = (r: (typeof relays)[number]) => ({ value: r.id, label: r.name, icon: <RelayIcon type={r.type} className="h-4 w-4 text-fg-subtle" /> });
  const texts = relays.filter((r) => r.type === 'text').map(option);
  const voices = relays.filter((r) => r.type === 'comm_link').map(option);
  const level = d.defaultNotifications ?? (memberCount > 100 ? 'mentions' : 'all');

  return (
    <>
      <SettingsTitle>Engagement</SettingsTitle>
      <p className="-mt-4 mb-6 text-sm text-fg-muted">Manage settings that help keep your {term('beacon').toLowerCase()} active.</p>

      <SettingsSection id="system" title="System Messages" description={`Configure system event messages sent to your ${term('beacon').toLowerCase()}.`}>
        <Switch label={`Send a random welcome message when someone joins this ${term('beacon').toLowerCase()}.`} checked={!!d.welcomeMessages} onChange={(v) => set('welcomeMessages', v)} />
        <Switch label="Prompt members to wave hello in reply to welcome messages." checked={!!d.welcomeWave} disabled={!d.welcomeMessages} onChange={(v) => set('welcomeWave', v)} />
        <Switch label={`Send helpful tips for ${term('beacon').toLowerCase()} setup.`} checked={!!d.setupTips} onChange={(v) => set('setupTips', v)} />
        <div className="flex items-center justify-between gap-6 pt-4">
          <div>
            <p className="text-[15px] font-semibold text-fg">System Messages {term('relay')}</p>
            <p className="mt-0.5 text-sm text-fg-muted">This is the {term('relay').toLowerCase()} we send system event messages to.</p>
          </div>
          <div className="w-72 shrink-0">
            <Dropdown
              hideLabel
              label={`System Messages ${term('relay')}`}
              value={d.systemChannelId ?? 'none'}
              options={[{ value: 'none', label: 'No System Messages' }, ...texts]}
              onChange={(v) => set('systemChannelId', v === 'none' ? null : v)}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="notifications"
        title="Default Notification Settings"
        description="This determines whether members who have not set their own notification settings get a notification for every transmission in this beacon, or only for mentions."
      >
        <RadioList
          label="Default notifications"
          value={level}
          onChange={(v) => set('defaultNotifications', v)}
          options={[
            { value: 'all', label: 'All Messages' },
            { value: 'mentions', label: 'Only @mentions', description: 'Recommended for large beacons.' },
          ]}
        />
      </SettingsSection>

      <SettingsSection id="inactive" title={`Inactive ${term('commLink')}`}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Dropdown
              label={`Inactive ${term('commLink')}`}
              value={d.afkChannelId ?? 'none'}
              options={[{ value: 'none', label: `No Inactive ${term('commLink')}` }, ...voices]}
              onChange={(v) => set('afkChannelId', v === 'none' ? null : v)}
            />
          </div>
          <Dropdown label="Inactive Timeout" value={String(d.afkTimeout ?? 300)} options={TIMEOUTS} onChange={(v) => set('afkTimeout', Number(v))} />
        </div>
        <p className="mt-2 text-sm text-fg-muted">
          Members idle for longer than the inactive timeout move to this {term('commLink').toLowerCase()}, muted. Idle means no keyboard, mouse or touch input in Subspace.
        </p>
      </SettingsSection>
      <SaveBar visible={dirty} saving={saving} onReset={reset} onSave={() => void save()} />
    </>
  );
}
