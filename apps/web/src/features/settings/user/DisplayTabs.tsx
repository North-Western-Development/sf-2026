import { useA11yPrefs, setA11yPrefs } from '../../../lib/a11yPrefs';
import { REGIONS, useLocalePrefs, setLocalePrefs } from '../../../lib/locale';
import { formatFullDate, formatMessageTime } from '../../../lib/time';
import { SettingsSection, Switch, RadioList } from '../SettingsLayout';
import { useExplicitPrefs, setExplicitPrefs } from '../../../lib/explicitFilter';
import { http } from '../../../lib/http';
import { term } from '../../../lib/strings';
import { setState } from '../../../data/store';
import { confirmAction, toast } from '../../../app/ui';
import type { SelfUser } from '../../../lib/types';
import { Dropdown } from '../../common/Dropdown';

/** Discord's Accessibility page: saturation, link underlines, role colours, motion, send button. */
export function AccessibilityTab() {
  const p = useA11yPrefs();
  return (
    <>
      <SettingsSection id="saturation" title="Saturation" description="Reduce the saturation of colours in Subspace.">
        <div className="flex items-center gap-4">
          <input
            type="range"
            aria-label="Saturation"
            min={0}
            max={100}
            step={5}
            value={p.saturation}
            onChange={(e) => setA11yPrefs({ saturation: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-brand)]"
          />
          <span className="w-12 text-right text-sm tabular-nums text-fg-muted">{p.saturation}%</span>
        </div>
      </SettingsSection>
      <SettingsSection id="links" title="Links">
        <Switch label="Always underline links" description="Links in transmissions are underlined, not only when hovered." checked={p.underlineLinks} onChange={(v) => setA11yPrefs({ underlineLinks: v })} />
      </SettingsSection>
      <SettingsSection id="roles" title="Clearance Colours">
        <Switch label="Show clearance colours in names" description="Names take the colour of their highest coloured clearance." checked={p.roleColors} onChange={(v) => setA11yPrefs({ roleColors: v })} />
      </SettingsSection>
      <SettingsSection id="motion" title="Reduced Motion">
        <RadioList
          label="Reduced motion"
          value={p.reducedMotion}
          onChange={(v) => setA11yPrefs({ reducedMotion: v })}
          options={[
            { value: 'auto', label: 'Sync with computer', description: 'Follow your operating system’s reduce-motion setting.' },
            { value: 'on', label: 'Reduce motion', description: 'Turn off animations and transitions everywhere.' },
          ]}
        />
      </SettingsSection>
      <SettingsSection id="input" title="Message Box">
        <Switch label="Show Send button" description="A button to send, beside the emoji button, for anyone who prefers clicking to Enter." checked={p.sendButton} onChange={(v) => setA11yPrefs({ sendButton: v })} />
      </SettingsSection>
    </>
  );
}

/** Data & Privacy › Safety: DMs from beacon members, and sensitive media. */
export function SafetySettings({ me }: { me: SelfUser }) {
  const media = useExplicitPrefs();
  const allow = me.defaultAllowDms !== false;
  const save = async (v: boolean, applyToExistingBeacons: boolean) => {
    try {
      const res = await http.patch<{ transmitter: Partial<SelfUser> }>('/users/@me/profile', { defaultAllowDms: v, applyToExistingBeacons });
      setState((s) => ({ me: s.me ? { ...s.me, ...res.transmitter } : s.me }));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const choice = (key: keyof typeof media, label: string, description: string) => (
    <div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-b-0">
      <div>
        <p className="text-[15px] font-semibold text-fg">{label}</p>
        <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
      </div>
      <div className="w-36 shrink-0">
        <Dropdown
          hideLabel
          label={label}
          value={media[key]}
          options={[
            { value: 'show', label: 'Show' },
            { value: 'blur', label: 'Blur' },
          ]}
          onChange={(v) => setExplicitPrefs({ [key]: v })}
        />
      </div>
    </div>
  );
  return (
    <>
      <SettingsSection id="safety" title="Direct Links">
        <Switch
          label={`Allow ${term('link', true).toLowerCase()} from other members in ${term('beacon', true).toLowerCase()} you join`}
          description={`Each ${term('beacon').toLowerCase()}’s Privacy Settings start from this. ${term('affiliate', true)} can always reach you.`}
          checked={allow}
          onChange={(v) =>
            confirmAction({
              title: 'Apply to existing beacons?',
              body: `Do you want this to apply to the ${term('beacon', true).toLowerCase()} you are already in too, or only to ones you join from now on?`,
              confirmLabel: 'Apply to All',
              cancelLabel: 'Only New Ones',
              onConfirm: () => save(v, true),
              onCancel: () => void save(v, false),
            })
          }
        />
      </SettingsSection>
      <SettingsSection
        id="sensitive"
        title="Sensitive Media"
        description="Images are checked on this device by an image classifier and explicit ones are blurred until you click them. Nothing is sent anywhere to be checked."
      >
        {choice('dmFriends', `${term('link', true)} from ${term('affiliate', true).toLowerCase()}`, 'Images from people you are affiliated with.')}
        {choice('dmOthers', `${term('link', true)} from others`, 'Images from everyone else in your direct links and meshes.')}
        {choice('beacons', `${term('beacon')} ${term('relay', true).toLowerCase()}`, `Images in ${term('beacon', true).toLowerCase()}. A ${term('beacon').toLowerCase()}’s own filter can blur them too.`)}
      </SettingsSection>
    </>
  );
}

/** Language & Time: the region dates are written for, and a 12- or 24-hour clock. */
export function LanguageTimeTab() {
  const p = useLocalePrefs();
  const sample = new Date().toISOString();
  return (
    <>
      <SettingsSection id="language" title="Language" description="Subspace is available in English. Dates and times follow the region below.">
        <p className="rounded-md bg-raised px-3 py-2 text-sm text-fg">English</p>
      </SettingsSection>
      <SettingsSection id="region" title="Date and Time Format">
        <Dropdown label="Region" value={p.region} options={REGIONS} onChange={(v) => setLocalePrefs({ region: v })} />
        <div className="mt-4">
          <RadioList
            label="Clock"
            value={p.clock}
            onChange={(v) => setLocalePrefs({ clock: v })}
            options={[
              { value: 'auto', label: 'Use the region’s clock' },
              { value: '12', label: '12-hour clock', description: '3:04 PM' },
              { value: '24', label: '24-hour clock', description: '15:04' },
            ]}
          />
        </div>
        <div className="mt-4 rounded-lg bg-raised p-3 text-sm">
          <p className="text-xs font-semibold uppercase text-fg-subtle">Preview</p>
          <p className="mt-1 text-fg" data-testid="time-preview">
            {formatMessageTime(sample)}
          </p>
          <p className="text-fg-muted">{formatFullDate(sample)}</p>
        </div>
      </SettingsSection>
    </>
  );
}
