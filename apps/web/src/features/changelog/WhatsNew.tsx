import { Modal } from '@subspace/ui';
import { http } from '../../lib/http';
import { getState, setState } from '../../data/store';
import { closeModal, openModal, useUi } from '../../app/ui';
import { changelogFor, currentPlatform, entryDate, unseenEntries, type ChangelogEntry, type ChangelogItem } from './changelog';

const SECTIONS = [
  { key: 'added', label: 'New Features', tone: 'text-online' },
  { key: 'improved', label: 'Improvements', tone: 'text-brand-sky' },
  { key: 'fixed', label: 'Bug Fixes', tone: 'text-danger' },
] as const;

function Section({ label, tone, items }: { label: string; tone: string; items: ChangelogItem[] }) {
  return (
    <section aria-label={label} className="mt-5">
      <h4 className={`flex items-center gap-3 text-xs font-bold uppercase tracking-wide ${tone}`}>
        {label}
        <span className="h-px flex-1 bg-current opacity-30" aria-hidden />
      </h4>
      <ul className="mt-2 space-y-2.5">
        {items.map((item) => (
          <li key={item.title} className="ml-4 list-disc text-sm leading-relaxed text-fg-muted marker:text-fg-subtle">
            <strong className="font-semibold text-fg">{item.title}:</strong> {item.body}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Entry({ entry, first }: { entry: ChangelogEntry; first: boolean }) {
  return (
    <article aria-label={entry.title} className={first ? '' : 'mt-8 border-t border-line pt-6'}>
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{entryDate(entry.id)}</p>
      <h3 className="mt-1 text-lg font-bold text-fg">{entry.title}</h3>
      {SECTIONS.map((s) => {
        const items = entry[s.key];
        return items?.length ? <Section key={s.key} label={s.label} tone={s.tone} items={items} /> : null;
      })}
    </article>
  );
}

/** What's New: the entries that just popped up, or (from User Settings) every one for this platform. */
export function WhatsNewModal({ entries }: { entries?: ChangelogEntry[] }) {
  const list = entries ?? changelogFor(currentPlatform());
  return (
    <Modal isOpen onClose={closeModal} title="What's New" maxWidth="lg">
      <div className="-mx-6 max-h-[65vh] overflow-y-auto px-6 pb-2">
        {list.length ? list.map((e, i) => <Entry key={e.id} entry={e} first={i === 0} />) : <p className="text-sm text-fg-muted">Nothing here yet.</p>}
      </div>
    </Modal>
  );
}

let checked = false;

/**
 * Once per session, after the app has loaded: show what changed on this platform since they last
 * looked, and remember the newest entry as seen on the account (so another browser does not show
 * it again). Waits for whatever dialog is open to close first.
 */
export function showWhatsNewOnce() {
  if (checked) return;
  const me = getState().me as { createdAt?: string; changelogSeen?: Record<string, string> } | null;
  if (!me) return;
  checked = true;
  const platform = currentPlatform();
  const seen = me.changelogSeen?.[platform];
  const newest = changelogFor(platform)[0]?.id;
  const entries = unseenEntries(platform, seen, me.createdAt);
  if (newest && seen !== newest) {
    void http.put<{ changelogSeen: Record<string, string> }>('/users/@me/changelog', { platform, seen: newest }).then(
      (r) => {
        const current = getState().me;
        if (current) setState({ me: { ...current, changelogSeen: r.changelogSeen } as typeof current });
      },
      () => {}
    );
  }
  if (!entries.length) return;
  const open = () => openModal({ kind: 'whatsNew', entries });
  if (!useUi.getState().modal) return open();
  const off = useUi.subscribe((s) => {
    if (s.modal) return;
    off();
    open();
  });
}
