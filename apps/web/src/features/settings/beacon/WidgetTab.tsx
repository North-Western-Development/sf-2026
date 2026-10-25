import { useShallow } from 'zustand/react/shallow';
import { Input } from '@subspace/ui';
import { useStore } from '../../../data/store';
import { term } from '../../../lib/strings';
import { copyText } from '../../../lib/clipboard';
import { Dropdown } from '../../common/Dropdown';
import { RelayIcon } from '../../sidebar/BeaconSidebar';
import { SettingsTitle, SettingsSection, Switch, SaveBar, Field, RowButton } from '../SettingsLayout';
import { useBeaconDraft } from './useBeaconDraft';

/** Discord's Server Widget: a public JSON feed and an embeddable card with an invite. */
export function WidgetTab({ beaconId }: { beaconId: string }) {
  const { d, set, dirty, saving, save, reset } = useBeaconDraft(beaconId, ['widgetEnabled', 'widgetChannelId'] as const);
  const relays = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter((r) => r?.type === 'text')));
  const origin = window.location.origin;
  const json = `${origin}/api/v1/beacons/${beaconId}/widget.json`;
  const embed = `<iframe src="${origin}/widget/${beaconId}" width="350" height="500" allowtransparency="true" frameborder="0" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"></iframe>`;

  return (
    <>
      <SettingsTitle>Widget</SettingsTitle>
      <SettingsSection id="widget">
        <Switch label={`Enable ${term('beacon')} Widget`} description="Anyone can see who is online and get an invite from the widget, signed in or not." checked={!!d.widgetEnabled} onChange={(v) => set('widgetEnabled', v)} />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label={`${term('beacon')} ID`}>
            <div className="flex gap-2">
              <Input aria-label={`${term('beacon')} ID`} readOnly value={beaconId} />
              <RowButton onClick={() => void copyText(beaconId, 'ID copied')}>Copy</RowButton>
            </div>
          </Field>
          <Dropdown
            label="Invite Relay"
            value={d.widgetChannelId ?? 'none'}
            options={[{ value: 'none', label: 'No Invite' }, ...relays.map((r) => ({ value: r.id, label: r.name, icon: <RelayIcon type={r.type} /> }))]}
            onChange={(v) => set('widgetChannelId', v === 'none' ? null : v)}
          />
        </div>
      </SettingsSection>
      <SettingsSection id="json" title="JSON API">
        <div className="flex gap-2">
          <Input aria-label="JSON API" readOnly value={json} />
          <RowButton onClick={() => void copyText(json, 'Copied')}>Copy</RowButton>
        </div>
      </SettingsSection>
      <SettingsSection id="embed" title="Premade Widget">
        <textarea aria-label="Premade widget" readOnly value={embed} rows={3} className="w-full rounded-md border border-line bg-void px-3 py-2 font-mono text-xs text-fg" />
        <div className="mt-2 flex gap-2">
          <RowButton onClick={() => void copyText(embed, 'Copied')}>Copy</RowButton>
          <RowButton onClick={() => window.open(`/widget/${beaconId}`, '_blank', 'noopener')}>Preview</RowButton>
        </div>
      </SettingsSection>
      <SaveBar visible={dirty} saving={saving} onReset={reset} onSave={() => void save()} />
    </>
  );
}
