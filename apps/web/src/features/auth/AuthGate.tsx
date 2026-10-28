import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@subspace/ui';
import { api } from '../../services/api';
import { gateway } from '../../services/gateway';
import { AuthScreen } from './AuthScreen';
import { LandingPage } from './LandingPage';
import { legalPageFor } from './LegalPages';
import { inAppShell } from '../../lib/native';
import { AuthHeading, AuthLayout, FormError } from './AuthLayout';
import { DirectivesList } from './DirectivesList';
import { PixelStar } from './PixelStar';
import { RegionBlockedPage } from './RegionBlocked';
import { checkRegion, useRegionBlocked } from '../../lib/regionBlock';

type GateState = 'restoring' | 'signed-out' | 'directives' | 'ready';

/**
 * Renders the app only for a signed-in transmitter who has accepted the current
 * Subspace Directives. Everything else sees the auth flow.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>(() => (api.hasSession() ? 'restoring' : 'signed-out'));
  const regionBlocked = useRegionBlocked();
  useEffect(() => {
    void checkRegion();
  }, []);
  useEffect(() => {
    if (regionBlocked) gateway.disconnect();
  }, [regionBlocked]);
  // Everyone lands on the homepage at /. Signed out, /login and /register are the forms, and any
  // other link (an invite, a channel) asks to sign in, then opens.
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const go = (to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
  };

  useEffect(() => {
    let cancelled = false;
    if (state === 'restoring') {
      api.restoreSession().then((session) => {
        if (cancelled) return;
        if (!session) setState('signed-out');
        else setState(session.requiresRulesAgreement ? 'directives' : 'ready');
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      api.onSessionChange((transmitter) => {
        if (!transmitter) {
          gateway.disconnect();
          setState('signed-out');
        }
      }),
    []
  );

  // Privacy, Terms and SMS Terms: public, signed in or not.
  const legal = legalPageFor(path);
  if (legal) return legal;
  // BLOCK_EU: the API refuses this visitor's region; everything but the legal pages is this page.
  if (regionBlocked) return <RegionBlockedPage />;

  if (path === '/' && !inAppShell()) {
    const signedIn = state !== 'signed-out';
    return <LandingPage signedIn={signedIn} onOpen={() => go('/channels/@me')} onLogin={() => go('/login')} onRegister={() => go('/register')} />;
  }

  if (state === 'restoring') {
    return (
      <div className="h-full w-full bg-void flex flex-col items-center justify-center gap-4" aria-busy="true">
        <PixelStar size={40} className="animate-[twinkle_1.6s_ease-in-out_infinite]" />
        <p className="text-sm text-fg-subtle">Tuning in...</p>
      </div>
    );
  }

  if (state === 'signed-out') {
    return (
      <AuthScreen
        key={path}
        initialMode={path === '/register' ? 'register' : 'login'}
        onAuthenticated={(result) => setState(result.requiresRulesAgreement ? 'directives' : 'ready')}
      />
    );
  }

  if (state === 'directives') {
    return <DirectivesGate onAccepted={() => setState('ready')} />;
  }

  return <>{children}</>;
}

function DirectivesGate({ onAccepted }: { onAccepted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.acceptDirectives();
      onAccepted();
    } catch {
      setError('Could not record your acceptance. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeading title="The Subspace Directives have changed" subtitle="Review and accept them to keep transmitting." />
      <FormError message={error} />
      <div className="rounded-lg border border-line bg-raised p-4 max-h-72 overflow-y-auto">
        <DirectivesList />
      </div>
      <Button size="lg" fullWidth className="mt-6" onClick={accept} isLoading={busy}>
        I accept
      </Button>
      <Button variant="ghost" fullWidth className="mt-2" onClick={() => void api.logout()}>
        Log out
      </Button>
    </AuthLayout>
  );
}
