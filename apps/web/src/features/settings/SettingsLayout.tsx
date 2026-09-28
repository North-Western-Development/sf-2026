import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Search, X } from 'lucide-react';
import { ComingSoon } from '@subspace/ui';

export interface SettingsItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
}

export interface SettingsSection {
  heading?: string;
  items: SettingsItem[];
}

/**
 * Discord-style windowed settings: a large modal over the dimmed app with a
 * searchable, iconed nav on the left and a titled, scrolling content pane.
 */
export function SettingsLayout({
  sections,
  active,
  onSelect,
  onClose,
  children,
  title,
  header,
}: {
  sections: SettingsSection[];
  active: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
  /** Identity card at the top of the nav (user or beacon). */
  header?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest?.('[role="dialog"][aria-modal="true"]:not([data-settings])')) onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const visible = sections
    .map((sec) => ({ ...sec, items: q ? sec.items.filter((it) => it.label.toLowerCase().includes(q)) : sec.items }))
    .filter((sec) => sec.items.length);
  const activeLabel = sections.flatMap((sec) => sec.items).find((it) => it.id === active)?.label ?? title;

  return createPortal(
    <div
      className="fixed inset-0 z-[900] flex items-center justify-center bg-black/70 p-0 animate-[fade-in_120ms_ease-out] sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-settings
        className="flex h-full w-full max-w-[1200px] overflow-hidden bg-base shadow-modal animate-[rise-in_160ms_var(--ease-out-soft)] sm:max-h-[960px] sm:rounded-xl"
      >
        <nav aria-label={`${title} sections`} className="flex w-[232px] shrink-0 flex-col border-r border-line bg-raised">
          <div className="shrink-0 px-3 pt-4">
            {header}
            <label className="mt-3 flex h-9 items-center gap-2 rounded-md border border-line bg-void px-2.5 text-fg-subtle focus-within:border-brand">
              <Search className="h-4 w-4 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search settings"
                className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
            {visible.map((sec, i) => (
              <div key={sec.heading ?? i} className={clsx(i > 0 && 'mt-2 border-t border-line pt-2')}>
                {sec.heading && <p className="truncate px-2 pb-1 pt-1.5 text-xs font-semibold text-fg-subtle">{sec.heading}</p>}
                {sec.items.map((it) => (
                  <NavItem key={it.id} item={it} active={active === it.id} onSelect={onSelect} />
                ))}
              </div>
            ))}
            {!visible.length && <p className="px-2 py-4 text-sm text-fg-subtle">No settings match "{query}".</p>}
          </div>
        </nav>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <h1 className="truncate text-[15px] font-semibold text-fg">{activeLabel}</h1>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              title="Close (Esc)"
              className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            >
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[640px] px-8 pb-20 pt-10">{children}</div>
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}

function NavItem({ item, active, onSelect }: { item: SettingsItem; active: boolean; onSelect: (id: string) => void }) {
  const body = (
    <>
      {item.icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>}
      <span className="truncate">{item.label}</span>
    </>
  );
  if (item.comingSoon) {
    return (
      <ComingSoon className="w-full" placement="right">
        <span className="mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[15px] text-fg-muted">{body}</span>
      </ComingSoon>
    );
  }
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => (item.onClick ? item.onClick() : onSelect(item.id))}
      className={clsx(
        'mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[15px] font-medium',
        item.danger ? 'text-danger hover:bg-danger-soft' : active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
      )}
    >
      {body}
    </button>
  );
}

/** Identity card for the top of the settings nav. */
export function SettingsHeader({ media, name, action }: { media: React.ReactNode; name: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="shrink-0">{media}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold leading-tight text-fg">{name}</span>
        {action}
      </span>
    </div>
  );
}

export function SettingsTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-5 text-xl font-bold text-fg">{children}</h2>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-bold uppercase text-fg-muted">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <div className={clsx('flex items-start justify-between gap-6 border-b border-line py-4', disabled && 'opacity-50')}>
      <div>
        <p className="font-medium text-fg">{label}</p>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-online' : 'bg-fg-disabled')}
      >
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </div>
  );
}

/** Sticky "unsaved changes" bar (Discord's "Careful — you have unsaved changes!"). */
export function SaveBar({ visible, onReset, onSave, saving }: { visible: boolean; onReset: () => void; onSave: () => void; saving?: boolean }) {
  if (!visible) return null;
  return (
    <div className="sticky bottom-4 z-10 mt-8 flex items-center justify-between rounded-lg bg-void px-4 py-2.5 shadow-pop animate-[rise-in_160ms_var(--ease-out-soft)]">
      <span className="text-sm font-medium text-fg">Careful — you have unsaved changes!</span>
      <span className="flex items-center gap-3">
        <button type="button" onClick={onReset} className="text-sm font-medium text-fg hover:underline">
          Reset
        </button>
        <button type="button" onClick={onSave} disabled={saving} className="rounded-md bg-online px-4 py-1.5 text-sm font-semibold text-void hover:brightness-110 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </span>
    </div>
  );
}
