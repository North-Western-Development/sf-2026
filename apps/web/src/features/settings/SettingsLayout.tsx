import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useIsMobile } from '../../app/mobile';
import { ComingSoon } from '@subspace/ui';

export interface SettingsSubItem {
  /** Matches the `id` of a <SettingsSection> on that page. */
  id: string;
  label: string;
}

export interface SettingsItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
  /** Jump links into sections of this page, shown under the item while it is active. */
  children?: SettingsSubItem[];
}

export interface SettingsSection {
  heading?: string;
  items: SettingsItem[];
}

const sectionDomId = (id: string) => `settings-section-${id}`;

/** Lets pages ask the layout for a wider content column (e.g. Profiles with its preview card). */
const WideContext = createContext<(wide: boolean) => void>(() => {});
export function useWideSettingsPage() {
  const setWide = useContext(WideContext);
  useEffect(() => {
    setWide(true);
    return () => setWide(false);
  }, [setWide]);
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
  const [wide, setWide] = useState(false);
  // Small screens show one pane: the section list, then the chosen page with a back button.
  const mobile = useIsMobile();
  const [pageOpen, setPageOpen] = useState(false);
  const select = (id: string) => {
    onSelect(id);
    setPageOpen(true);
  };
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pendingJump = useRef<string | null>(null);

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

  const allItems = sections.flatMap((sec) => sec.items);
  const activeItem = allItems.find((it) => it.id === active);
  const subs = activeItem?.children ?? [];

  // Scroll-spy: highlight the last section whose heading has scrolled past the top.
  const spy = useCallback(() => {
    const el = scroller.current;
    if (!el || !subs.length) return setActiveSub(null);
    const top = el.getBoundingClientRect().top + 24;
    let current = subs[0].id;
    for (const s of subs) {
      const node = document.getElementById(sectionDomId(s.id));
      if (node && node.getBoundingClientRect().top <= top) current = s.id;
    }
    // At the very bottom, the last section wins even if its heading cannot reach the top.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) current = subs[subs.length - 1].id;
    setActiveSub(current);
  }, [subs.map((s) => s.id).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = 0;
    if (pendingJump.current) {
      const id = pendingJump.current;
      pendingJump.current = null;
      requestAnimationFrame(() => jumpTo(id, false));
    }
    spy();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpTo = (id: string, smooth = true) => {
    const el = scroller.current;
    const node = document.getElementById(sectionDomId(id));
    if (!el || !node) return;
    el.scrollTo({ top: el.scrollTop + node.getBoundingClientRect().top - el.getBoundingClientRect().top - 32, behavior: smooth ? 'smooth' : 'auto' });
    setActiveSub(id);
  };

  const selectSub = (parent: string, id: string) => {
    setPageOpen(true);
    if (parent === active) return jumpTo(id);
    pendingJump.current = id;
    onSelect(parent);
  };

  const q = query.trim().toLowerCase();
  const visible = sections
    .map((sec) => ({
      ...sec,
      items: q ? sec.items.filter((it) => it.label.toLowerCase().includes(q) || it.children?.some((c) => c.label.toLowerCase().includes(q))) : sec.items,
    }))
    .filter((sec) => sec.items.length);

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
        <nav
          aria-label={`${title} sections`}
          className={clsx('flex shrink-0 flex-col border-r border-line bg-raised', mobile ? (pageOpen ? 'hidden' : 'w-full') : 'w-[232px]')}
        >
          <div className="shrink-0 px-3 pt-4">
            {mobile && (
              <div className="mb-3 flex items-center justify-between">
                <span className="font-semibold text-fg">{title}</span>
                <button type="button" onClick={onClose} aria-label="Close settings" className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
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
                  <div key={it.id}>
                    <NavItem item={it} active={active === it.id && !(mobile && !pageOpen)} onSelect={select} />
                    {it.children && (active === it.id || q) && (
                      <div className="mb-1 ml-[18px] border-l border-line-strong pl-2">
                        {it.children.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectSub(it.id, c.id)}
                            className={clsx(
                              '-ml-[9px] block w-[calc(100%+9px)] border-l-2 py-1 pl-[15px] pr-2 text-left text-sm',
                              active === it.id && activeSub === c.id ? 'border-fg font-medium text-fg' : 'border-transparent text-fg-muted hover:text-fg'
                            )}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {!visible.length && <p className="px-2 py-4 text-sm text-fg-subtle">No settings match "{query}".</p>}
          </div>
        </nav>
        <section className={clsx('min-w-0 flex-1 flex-col', mobile && !pageOpen ? 'hidden' : 'flex')}>
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            {mobile && (
              <button type="button" onClick={() => setPageOpen(false)} aria-label="Back to settings" className="-ml-1 mr-1 flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">{activeItem?.label ?? title}</h1>
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
          <div ref={scroller} onScroll={spy} className="min-h-0 flex-1 overflow-y-auto">
            <div className={clsx('mx-auto w-full px-4 pb-24 pt-6 md:px-8 md:pt-10', wide ? 'max-w-[820px]' : 'max-w-[640px]')}>
              <WideContext.Provider value={setWide}>{children}</WideContext.Provider>
            </div>
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

// ---------------------------------------------------------------------------
// Page building blocks
// ---------------------------------------------------------------------------

/** Page heading for pages without sections. */
export function SettingsTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-6 text-xl font-semibold text-fg">{children}</h2>;
}

/** A titled block of a settings page; consecutive sections are separated by a divider. */
export function SettingsSection({ id, title, description, children }: { id?: string; title?: React.ReactNode; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id ? sectionDomId(id) : undefined} className="border-b border-line pb-8 pt-8 first:pt-0 last:border-b-0">
      {title && <h2 className="text-xl font-semibold text-fg">{title}</h2>}
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      <div className={clsx(title && 'mt-4')}>{children}</div>
    </section>
  );
}

/** Label on the left, value and action on the right (Discord's account rows). */
export function SettingsRow({
  label,
  description,
  icon,
  value,
  action,
  onClick,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  value?: React.ReactNode;
  action?: React.ReactNode;
  /** Makes the whole row a button with a trailing chevron. */
  onClick?: () => void;
}) {
  const inner = (
    <>
      {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised text-fg-muted [&>svg]:h-5 [&>svg]:w-5">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-fg-muted">{description}</span>}
      </span>
      {value !== undefined && <span className="min-w-0 truncate text-right text-[15px] text-fg">{value}</span>}
      {action}
      {onClick && <ChevronRight className="h-5 w-5 shrink-0 text-fg-muted" />}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="-mx-3 flex min-h-[60px] w-[calc(100%+1.5rem)] items-center gap-4 rounded-lg px-3 py-2.5 text-left hover:bg-hover">
        {inner}
      </button>
    );
  }
  return <div className="flex min-h-[60px] items-center gap-4 py-2.5">{inner}</div>;
}

/** Secondary button used for row actions ("Edit", "Change Avatar"). */
export function RowButton({ children, onClick, danger, disabled }: { children: React.ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50',
        danger ? 'bg-danger text-white hover:brightness-110' : 'bg-active text-fg hover:bg-line-strong'
      )}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      {label && <p className="mb-2 text-sm font-semibold text-fg">{label}</p>}
      {children}
      {hint && <p className="mt-1.5 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <div className={clsx('flex items-start justify-between gap-6 border-b border-line py-4 last:border-b-0', disabled && 'opacity-50')}>
      <div>
        <p className="text-[15px] font-semibold text-fg">{label}</p>
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

/** Discord-style radio list: one bordered row per option. */
export function RadioList<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; description?: string }>;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
              on ? 'border-brand bg-brand/10' : 'border-line bg-raised hover:bg-hover'
            )}
          >
            <span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-brand' : 'border-fg-subtle')}>
              {on && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-fg">{o.label}</span>
              {o.description && <span className="block text-sm text-fg-muted">{o.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Native select styled to match inputs. */
export function SelectField({ value, onChange, children, label }: { value: string | number; onChange: (v: string) => void; children: React.ReactNode; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full cursor-pointer rounded-md border border-line bg-void px-3 text-[15px] text-fg outline-none focus:border-brand"
    >
      {children}
    </select>
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

export { ComingSoon };
