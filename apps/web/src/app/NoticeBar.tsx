import { useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../data/store';
import { http, ApiError } from '../lib/http';
import { toast } from './ui';

/** Discord's full-width notice above the app: here, the unverified-email reminder. */
export function NoticeBar() {
  const unverified = useStore((s) => s.me && s.me.isEmailVerified === false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('subspace_verify_notice') === 'dismissed');
  const [busy, setBusy] = useState(false);
  if (!unverified || dismissed) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await http.post('/auth/verify-email/resend');
      toast('Verification email sent. Check your inbox.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not send the email', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="relative flex h-9 shrink-0 items-center justify-center gap-3 bg-brand px-10 text-sm font-medium text-on-brand">
      <span className="truncate">Please check your email and follow the instructions to verify your account.</span>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={busy}
        className="shrink-0 rounded-[3px] border border-white/80 px-2 py-0.5 text-xs font-semibold hover:bg-white/15 disabled:opacity-60"
      >
        Resend
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          sessionStorage.setItem('subspace_verify_notice', 'dismissed');
          setDismissed(true);
        }}
        className="absolute right-3 opacity-80 hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
