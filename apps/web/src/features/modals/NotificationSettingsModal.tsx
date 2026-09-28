import { useState } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { Modal } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { isMuted, settingFor } from '../../data/notifications';
import { muteDurations, setNotificationSetting } from '../../data/notificationActions';
import type { NotificationLevel } from '../../lib/types';
import { closeModal, toast } from '../../app/ui';
import { term } from '../../lib/strings';
import { RelayIcon } from '../sidebar/BeaconSidebar';

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 border-b border-line py-3">
      <span>
        <span className="block font-medium text-fg">{label}</span>
        {description && <span className="block text-sm text-fg-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-online' : 'bg-fg-disabled')}
      >
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

const LEVELS: Array<{ level: Exclude<NotificationLevel, 'inherit'>; label: string }> = [
  { level: 'all', label: 'All Transmissions' },
  { level: 'mentions', label: 'Only @mentions' },
  { level: 'nothing', label: 'Nothing' },
];

/** Discord's server Notification Settings dialog. */
export function NotificationSettingsModal({ beaconId }: { beaconId: string }) {
  const beacon = useStore((s) => s.beacons[beaconId]);
  const setting = useStore((s) => settingFor(s, 'beacon', beaconId));
  const relays = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter(Boolean)));
  const overrides = useStore(
    useShallow((s) => relays.filter((r) => settingFor(s, r.type === 'category' ? 'category' : 'relay', r.id)).map((r) => r.id))
  );
  const allSettings = useStore((s) => s.notificationSettings);
  const [adding, setAdding] = useState('');
  const muted = isMuted(setting);
  const level = setting?.level && setting.level !== 'inherit' ? setting.level : 'mentions';

  const save = (patch: Parameters<typeof setNotificationSetting>[2]) =>
    void setNotificationSetting('beacon', beaconId, patch).catch(() => toast('Could not save notification settings', 'error'));

  return (
    <Modal isOpen onClose={closeModal} title="Notification Settings" description={beacon?.name} maxWidth="xl">
      <Toggle
        label={`Mute ${beacon?.name}`}
        description={`Muting a ${term('beacon').toLowerCase()} prevents unread indicators and notifications from appearing unless you are mentioned.`}
        checked={muted}
        onChange={(v) => save({ mutedUntil: v ? 'infinity' : null })}
      />
      {muted && setting?.mutedUntil && setting.mutedUntil !== 'infinity' && !setting.mutedUntil.startsWith('9999') && (
        <p className="pt-1 text-xs text-fg-subtle">Muted until {new Date(setting.mutedUntil).toLocaleString()}</p>
      )}
      {!muted && (
        <div className="flex flex-wrap gap-2 pt-2">
          {muteDurations()
            .slice(0, 5)
            .map((d) => (
              <button key={d.label} type="button" onClick={() => save({ mutedUntil: d.until() })} className="rounded-md bg-raised px-2 py-1 text-xs text-fg-muted hover:bg-hover hover:text-fg">
                Mute {d.label.toLowerCase()}
              </button>
            ))}
        </div>
      )}

      <fieldset className="mt-5">
        <legend className="mb-2 text-xs font-bold uppercase text-fg-muted">{term('beacon')} Notification Settings</legend>
        {LEVELS.map((l) => (
          <label key={l.level} className={clsx('mb-2 flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5', level === l.level ? 'bg-active' : 'bg-raised hover:bg-hover')}>
            <input type="radio" name="level" checked={level === l.level} onChange={() => save({ level: l.level })} className="accent-[var(--color-brand)]" />
            <span className="text-fg">{l.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="mt-4">
        <Toggle label="Suppress @everyone and @here" checked={!!setting?.suppressEveryone} onChange={(v) => save({ suppressEveryone: v })} />
        <Toggle label="Suppress All Clearance @mentions" checked={!!setting?.suppressRoles} onChange={(v) => save({ suppressRoles: v })} />
        <Toggle label="Suppress Highlights" description="You won't get highlights for this beacon." checked={!!setting?.suppressHighlights} onChange={(v) => save({ suppressHighlights: v })} />
        <Toggle label="Mobile Push Notifications" checked={setting?.mobilePush ?? true} onChange={(v) => save({ mobilePush: v })} />
      </div>

      <section className="mt-5">
        <h3 className="mb-2 text-xs font-bold uppercase text-fg-muted">Notification Overrides</h3>
        <div className="flex gap-2">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} className="h-10 flex-1 rounded-md border border-line bg-void px-2 text-sm text-fg" aria-label="Add a relay or band override">
            <option value="">Select a {term('relay').toLowerCase()} or {term('band').toLowerCase()}</option>
            {relays
              .filter((r) => !overrides.includes(r.id))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.type === 'category' ? `${r.name.toUpperCase()} (${term('band')})` : `#${r.name}`}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              const r = relays.find((x) => x.id === adding);
              if (r) void setNotificationSetting(r.type === 'category' ? 'category' : 'relay', r.id, { level: 'inherit' });
              setAdding('');
            }}
            className="rounded-md bg-brand px-3 text-sm font-medium text-on-brand disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {overrides.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-fg-subtle">
                <th className="py-1 font-semibold">{term('relay')} or {term('band')}</th>
                {LEVELS.map((l) => (
                  <th key={l.level} className="w-20 py-1 text-center font-semibold">
                    {l.level === 'mentions' ? '@mentions' : l.level === 'all' ? 'All' : 'Nothing'}
                  </th>
                ))}
                <th className="w-16 py-1 text-center font-semibold">Mute</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {overrides.map((id) => {
                const r = relays.find((x) => x.id === id)!;
                const scope = r.type === 'category' ? 'category' : 'relay';
                const st = allSettings[`${scope}:${id}`];
                return (
                  <tr key={id} className="border-t border-line">
                    <td className="py-2">
                      <span className="flex items-center gap-1.5 text-fg">
                        {r.type !== 'category' && <RelayIcon type={r.type} className="h-4 w-4 text-fg-subtle" />}
                        {r.name}
                      </span>
                    </td>
                    {LEVELS.map((l) => (
                      <td key={l.level} className="text-center">
                        <input
                          type="radio"
                          aria-label={`${r.name}: ${l.label}`}
                          checked={st?.level === l.level}
                          onChange={() => void setNotificationSetting(scope, id, { level: l.level })}
                          className="accent-[var(--color-brand)]"
                        />
                      </td>
                    ))}
                    <td className="text-center">
                      <input type="checkbox" aria-label={`Mute ${r.name}`} checked={isMuted(st)} onChange={(e) => void setNotificationSetting(scope, id, { mutedUntil: e.target.checked ? 'infinity' : null })} className="accent-[var(--color-brand)]" />
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        aria-label={`Remove override for ${r.name}`}
                        onClick={() => void setNotificationSetting(scope, id, { level: 'inherit', mutedUntil: null })}
                        className="text-fg-subtle hover:text-danger"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </Modal>
  );
}
