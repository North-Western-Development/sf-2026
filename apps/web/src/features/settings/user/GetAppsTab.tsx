import { Download, Monitor, Smartphone } from 'lucide-react';
import { SettingsSection } from '../SettingsLayout';

const APPS = [
  {
    icon: Monitor,
    name: 'Windows',
    href: '/downloads/desktop/Subspace-Frequency-Setup.exe',
    note: 'The installer is not code-signed yet, so Windows SmartScreen asks first: choose More info, then Run anyway. The app updates itself.',
  },
  {
    icon: Smartphone,
    name: 'Android',
    href: '/downloads/mobile/Subspace-Frequency.apk',
    note: 'Allow your browser to install apps when Android asks. For notifications while Subspace is closed, install a UnifiedPush app such as ntfy; Subspace walks you through it.',
  },
  {
    icon: Smartphone,
    name: 'iPhone and iPad',
    href: '/downloads/mobile/Subspace-Frequency.ipa',
    note: 'For sideloading with AltStore, SideStore or Sideloadly, which sign it with your own Apple ID. Sideloaded copies cannot receive push notifications, so notifications arrive only while the app is open.',
  },
];

/** Download links for the desktop and mobile apps this instance publishes. */
export function GetAppsTab() {
  return (
    <SettingsSection id="get-apps" title="Get the Apps" description="The apps open this instance, so they always match it.">
      <ul className="space-y-3">
        {APPS.map((a) => (
          <li key={a.name} className="flex items-start gap-4 rounded-lg bg-raised p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-active text-fg-muted">
              <a.icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">{a.name}</p>
              <p className="mt-0.5 text-sm text-fg-muted">{a.note}</p>
            </div>
            <a
              href={a.href}
              download
              aria-label={`Download for ${a.name}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-on-brand hover:bg-brand-strong"
            >
              <Download className="h-4 w-4" aria-hidden /> Download
            </a>
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
