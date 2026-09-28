import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useUi } from './ui';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return createPortal(
    <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-[4000] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={clsx(
            'pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium shadow-pop animate-[rise-in_160ms_var(--ease-out-soft)]',
            t.tone === 'error' ? 'bg-danger text-white' : t.tone === 'success' ? 'bg-online text-void' : 'bg-overlay text-fg'
          )}
        >
          {t.message}
        </div>
      ))}
    </div>,
    document.body
  );
}
