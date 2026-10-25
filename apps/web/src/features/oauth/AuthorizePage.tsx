import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Check, ShieldCheck } from 'lucide-react';
import { Button } from '@subspace/ui';
import { http } from '../../lib/http';
import { useStore } from '../../data/store';
import { Avatar } from '../common/Avatar';
import { AppIcon, SCOPE_TEXT } from '../settings/user/AppsTabs';

interface AppInfo {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  owner: string;
}

/**
 * /oauth2/authorize: Discord's consent screen. An app sends you here with
 * client_id, redirect_uri, response_type=code, scope, and optionally state and a PKCE challenge.
 */
export function AuthorizePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const [app, setApp] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clientId = params.get('client_id') ?? '';
  const scopes = useMemo(() => [...new Set((params.get('scope') ?? '').split(/[\s+]+/).filter(Boolean))], [params]);

  useEffect(() => {
    if (params.get('response_type') !== 'code') return setError('This app asked in a way Subspace does not support (response_type must be code).');
    if (!scopes.length) return setError('This app did not say what it wants access to.');
    http.get<{ application: AppInfo }>(`/oauth2/applications/${encodeURIComponent(clientId)}`).then(
      (r) => setApp(r.application),
      () => setError('This application does not exist.')
    );
  }, [clientId, params, scopes.length]);

  const authorize = async () => {
    setBusy(true);
    try {
      const { location } = await http.post<{ location: string }>('/oauth2/authorize', {
        clientId,
        redirectUri: params.get('redirect_uri') ?? '',
        scope: scopes.join(' '),
        ...(params.get('state') ? { state: params.get('state')! } : {}),
        ...(params.get('code_challenge') ? { codeChallenge: params.get('code_challenge')!, codeChallengeMethod: 'S256' } : {}),
      });
      window.location.assign(location);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-void p-4">
      <section aria-label="Authorize application" className="w-full max-w-md rounded-xl bg-overlay p-6 shadow-pop ring-1 ring-line">
        {error ? (
          <>
            <h1 className="text-xl font-bold text-fg">Can't authorize</h1>
            <p className="mt-2 text-fg-muted">{error}</p>
            <Button className="mt-6 w-full" onClick={() => navigate('/channels/@me')}>
              Back to Subspace
            </Button>
          </>
        ) : !app || !me ? (
          <p className="text-fg-subtle">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-center gap-4">
              <AppIcon name={app.name} iconUrl={app.iconUrl} size={64} />
              <span className="h-px w-8 border-t border-dashed border-line-strong" />
              <Avatar user={me} size={64} decoration={false} />
            </div>
            <p className="mt-4 text-center text-sm text-fg-muted">An external application</p>
            <h1 className="text-center text-2xl font-bold text-fg">{app.name}</h1>
            <p className="text-center text-sm text-fg-muted">wants to access your Subspace account</p>
            <p className="mt-1 text-center text-xs text-fg-subtle">
              Signed in as {me.displayName || me.username} · made by {app.owner}
            </p>
            <p className="mt-6 text-xs font-semibold uppercase text-fg-muted">This will allow {app.name} to:</p>
            <ul aria-label="Requested permissions" className="mt-2 space-y-2">
              {scopes.map((s) => (
                <li key={s} className="flex items-center gap-2 text-sm text-fg">
                  <Check className="h-4 w-4 shrink-0 text-online" />
                  {SCOPE_TEXT[s] ?? s}
                </li>
              ))}
            </ul>
            <p className="mt-6 flex items-start gap-2 rounded-md bg-raised p-3 text-xs text-fg-muted">
              <ShieldCheck className="h-4 w-4 shrink-0 text-fg-subtle" />
              It cannot read your messages or act as you. You can deauthorize it anytime in User Settings › Authorized Apps.
            </p>
            <div className="mt-6 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => navigate('/channels/@me')}>
                Cancel
              </Button>
              <Button className="flex-1" isLoading={busy} onClick={() => void authorize()}>
                Authorize
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
