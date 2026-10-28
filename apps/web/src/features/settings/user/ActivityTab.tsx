import { useState } from 'react';
import { Download, Gamepad2, X } from 'lucide-react';
import type { ActivityVisibility } from '@subspace/constants';
import { useStore } from '../../../data/store';
import { toast } from '../../../app/ui';
import { term } from '../../../lib/strings';
import { RadioList, SettingsSection, Switch } from '../SettingsLayout';
import { canDetectGames, forgetGame, setActivityVisibility, setGameHidden, useActivity, visibilityOf } from '../../activity/activity';

/** User Settings › Activity Privacy: whether (and with whom) what I play is shared, and which games. */
export function ActivityTab() {
  const me = useStore((s) => s.me);
  const visibility = visibilityOf(me);
  // Turning sharing back on restores the audience picked before.
  const [lastAudience, setLastAudience] = useState<Exclude<ActivityVisibility, 'off'>>(visibility === 'friends' ? 'friends' : 'everyone');
  const { native, hidden, seen } = useActivity();
  const desktop = canDetectGames();
  const playing = native?.detected?.name;

  const save = (v: ActivityVisibility) => {
    if (v !== 'off') setLastAudience(v);
    void setActivityVisibility(v).catch((e) => toast((e as Error).message, 'error'));
  };

  return (
    <>
      <SettingsSection
        id="activity-status"
        title="Activity Status"
        description="Show what you are playing next to your name, in member lists and on your profile. It is never saved: it disappears when you stop playing, and Invisible hides it."
      >
        <Switch label="Share my activity" checked={visibility !== 'off'} onChange={(on) => save(on ? lastAudience : 'off')} />
        {visibility !== 'off' && (
          <div className="pt-2">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-fg-muted">Who can see it</p>
            <RadioList
              label="Who can see your activity"
              value={visibility}
              onChange={(v) => save(v)}
              options={[
                { value: 'everyone', label: 'Everyone', description: `People who can see your status: your ${term('affiliate', true).toLowerCase()} and members of your ${term('beacon', true).toLowerCase()}.` },
                { value: 'friends', label: `${term('affiliate', true)} only` },
              ]}
            />
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="detected-games"
        title="Detected Games"
        description={
          desktop
            ? 'The Subspace desktop app checks which known games are running on this computer. Only the name of the game is shared, never anything else running on your PC.'
            : 'Games are detected by the Subspace desktop app. In the browser nothing is checked.'
        }
      >
        {!desktop && (
          <a
            href="/downloads/desktop/Subspace-Frequency-Setup.exe"
            download
            className="mb-3 inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-strong"
          >
            <Download className="h-4 w-4" aria-hidden /> Download for Windows
          </a>
        )}
        {desktop && (
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-raised p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-active text-fg-muted">
              <Gamepad2 className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{playing ?? 'No game detected'}</p>
              <p className="text-sm text-fg-muted">
                {playing
                  ? visibility === 'off'
                    ? 'Playing now, not shared'
                    : hidden.includes(playing)
                      ? 'Playing now, hidden'
                      : 'Playing now, shared'
                  : 'Start a game and it shows up here.'}
              </p>
            </div>
          </div>
        )}
        {seen.length > 0 && (
          <ul aria-label="Games on this device" className="divide-y divide-line">
            {seen.map((g) => (
              <li key={g.name} aria-label={g.name} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-fg">{g.name}</span>
                  <span className="block text-xs text-fg-subtle">Last played {new Date(g.lastSeen).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
                </span>
                <label className="flex items-center gap-2 text-sm text-fg-muted">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={!hidden.includes(g.name)} onChange={(e) => setGameHidden(g.name, !e.target.checked)} />
                  Show
                </label>
                <button type="button" aria-label={`Forget ${g.name}`} onClick={() => forgetGame(g.name)} className="rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        id="rich-presence"
        title="Rich Presence"
        description="Games and apps that support Subspace Rich Presence can show more, like the map you are on or your party size. They talk to the desktop app on this computer only, and the same privacy settings apply."
      >
        <a href={`https://docs.${window.location.hostname}/guide/rich-presence`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-sky hover:underline">
          Rich Presence for developers
        </a>
      </SettingsSection>
    </>
  );
}
