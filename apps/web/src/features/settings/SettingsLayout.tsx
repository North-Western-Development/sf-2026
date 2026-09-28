import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { ComingSoon } from '@subspace/ui';

export interface SettingsSection {
  heading?: string;
  items: Array<{ id: string; label: string; danger?: boolean; comingSoon?: boolean; onClick?: () => void }>;
}

/** Discord-style full-screen settings surface (sidebar + content + ESC close). */
export function SettingsLayout({
  sections,
  active,
  onSelect,
  onClose,
  children,
  title,
}: {
  sections: SettingsSection[];
  active: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
}) {
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

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} data-settings className="fixed inset-0 z-[900] flex bg-base animate-[fade-in_120ms_ease-out]">
      <nav aria-label={`${title} sections`} className="flex w-[35%] min-w-[218px] justify-end overflow-y-auto bg-raised">
        <div className="w-[218px] px-2 py-14">
          {sections.map((sec, i) => (
            <div key={i} className={clsx(i > 0 && 'mt-2 border-t border-line pt-2')}>
              {sec.heading && <p className="px-2.5 pb-1.5 pt-1 text-xs font-bold uppercase text-fg-subtle">{sec.heading}</p>}
              {sec.items.map((it) =>
                it.comingSoon ? (
                  <ComingSoon key={it.id} className="w-full" placement="right">
                    <span className="block w-full rounded-md px-2.5 py-1.5 text-[15px] text-fg-muted">{it.label}</span>
                  </ComingSoon>
                ) : (
                  <button
                    key={it.id}
                    type="button"
                    aria-current={active === it.id ? 'page' : undefined}
                    onClick={() => (it.onClick ? it.onClick() : onSelect(it.id))}
                    className={clsx(
                      'mb-0.5 block w-full rounded-md px-2.5 py-1.5 text-left text-[15px] font-medium',
                      it.danger ? 'text-danger hover:bg-danger-soft' : active === it.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                    )}
                  >
                    {it.label}
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      </nav>
      <main className="flex min-w-0 flex-1 overflow-y-auto">
        <div className="w-full max-w-[740px] px-10 pb-20 pt-14">{children}</div>
        <div className="shrink-0 pr-5 pt-14">
          <button type="button" onClick={onClose} aria-label="Close settings" className="flex flex-col items-center gap-1 text-fg-muted hover:text-fg">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-current">
              <X className="h-5 w-5" />
            </span>
            <span className="text-xs font-semibold">ESC</span>
          </button>
        </div>
      </main>
    </div>,
    document.body
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
