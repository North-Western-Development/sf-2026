import { useEffect, useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { Button } from '@subspace/ui';
import { AuthLayout } from './AuthLayout';

type Outcome = { status: 'done' } | { status: 'failed'; message: string };

// The token is single-use, so the request must happen once per page load, even when React
// runs effects twice in development.
let attempt: Promise<Outcome> | null = null;
function verifyOnce(): Promise<Outcome> {
  attempt ??= (async () => {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    // Keep the token out of history and any later Referer.
    window.history.replaceState(null, '', '/verify-email');
    try {
      const res = await fetch('/api/v1/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (res.ok) return { status: 'done' };
      const data = await res.json().catch(() => ({}));
      return { status: 'failed', message: data.error || 'This link could not be used.' };
    } catch {
      return { status: 'failed', message: 'The Subspace network is unavailable. Try again shortly.' };
    }
  })();
  return attempt;
}

/**
 * /verify-email?token=… — the link from the verification email. Works signed in or out, so it
 * is rendered outside the auth gate.
 */
export function VerifyEmailPage() {
  const [state, setState] = useState<{ status: 'working' } | { status: 'done' } | { status: 'failed'; message: string }>({ status: 'working' });

  useEffect(() => {
    let live = true;
    void verifyOnce().then((result) => live && setState(result));
    return () => {
      live = false;
    };
  }, []);

  const go = () => window.location.assign('/channels/@me');

  return (
    <AuthLayout>
      <div className="flex flex-col items-center text-center" aria-live="polite">
        {state.status === 'working' && <p className="py-10 text-fg-muted">Verifying your email…</p>}
        {state.status === 'done' && (
          <>
            <CircleCheck className="h-16 w-16 text-online" aria-hidden />
            <h1 className="mt-4 text-2xl font-bold text-fg">Email Verified!</h1>
            <p className="mt-2 text-fg-muted">Thanks for confirming your address.</p>
            <Button size="lg" fullWidth className="mt-6" onClick={go}>
              Continue to Subspace
            </Button>
          </>
        )}
        {state.status === 'failed' && (
          <>
            <CircleX className="h-16 w-16 text-danger" aria-hidden />
            <h1 className="mt-4 text-2xl font-bold text-fg">Verification Failed</h1>
            <p className="mt-2 text-fg-muted">{state.message}</p>
            <Button size="lg" fullWidth className="mt-6" onClick={go}>
              Continue to Subspace
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
