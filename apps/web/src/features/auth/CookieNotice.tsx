import { useState } from 'react';
import { Cookie } from 'lucide-react';
import { Button } from '@subspace/ui';

const KEY = 'subspace:cookie-notice';

/**
 * The cookie notice. Subspace only uses storage the app needs to work (no analytics,
 * advertising or tracking), so this informs rather than asks for consent. Shown until dismissed.
 */
export function CookieNotice() {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  if (seen) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: show it again next time */
    }
    setSeen(true);
  };
  return (
    <aside
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-2xl flex-col gap-3 rounded-lg bg-overlay p-4 text-sm text-fg shadow-pop ring-1 ring-line sm:flex-row sm:items-center"
    >
      <Cookie className="hidden h-6 w-6 shrink-0 text-fg-muted sm:block" aria-hidden />
      <p className="min-w-0 flex-1 text-fg-muted">
        Subspace uses only essential cookies and browser storage: to keep you signed in, remember your settings, and keep encryption keys on this
        device. There are no advertising, analytics or tracking cookies.
      </p>
      <Button size="sm" onClick={dismiss}>
        Got it
      </Button>
    </aside>
  );
}
