import { useEffect, useMemo, useState } from 'react';
import { AppTag } from '../common/AppTag';
import { useNavigate, useSearchParams } from 'react-router';
import { Check, ShieldCheck } from 'lucide-react';
import { Button } from '@subspace/ui';
import { http } from '../../lib/http';
import { useStore } from '../../data/store';
import { useShallow } from 'zustand/react/shallow';
import { Avatar } from '../common/Avatar';
import { AppIcon, SCOPE_TEXT } from '../settings/user/AppsTabs';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { PERMISSION_GROUPS } from '../../lib/permissionMeta';
import { refreshBeacons } from '../../data/actions';
import { toast } from '../../app/ui';

interface AppInfo {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  owner: string;
  /** Present when the app has a bot that can be added to beacons. */
  bot?: { isPublic: boolean; ownerId: string; canAdd?: boolean; verified?: boolean; userId?: string } | null;
}

/**
 * scope=bot: add an app's bot to a beacon you manage, with the permissions the link asks for
 * (you may untick any). Discord's "Add to Server" screen.
 */
function AddBot({ app, requested }: { app: AppInfo; requested: bigint }) {
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const beacons = useStore(useShallow((s) => s.beaconOrder.map((id) => s.beacons[id]).filter((b) => b && can(beaconPermissions(s, b.id), PERMISSIONS.MANAGE_BEACON))));
  const [beaconId, setBeaconId] = useState('');
  const asked = PERMISSION_GROUPS.flatMap((g) => g.items).filter((p) => (requested & p.bit) === p.bit);
  const [granted, setGranted] = useState<Set<string>>(() => new Set(asked.map((p) => p.key)));
  const [busy, setBusy] = useState(false);
  const canAdd = app.bot && (app.bot.canAdd ?? (app.bot.isPublic || app.bot.ownerId === me?.id));
  const add = async () => {
    setBusy(true);
    try {
      const bits = asked.filter((p) => granted.has(p.key)).reduce((acc, p) => acc | p.bit, 0n);
      await http.post(`/beacons/${beaconId}/bots`, { appId: app.id, permissions: bits.toString() });
      toast(`${app.name} was added.`, 'success');
      await refreshBeacons().catch(() => undefined);
      navigate(`/channels/${beaconId}`);
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };
  if (!canAdd) return <p className="mt-4 text-center text-fg-muted">{app.bot ? 'Only its developer can add this bot.' : 'This application has no bot.'}</p>;
  return (
    <>
      <p className="mt-6 text-xs font-semibold uppercase text-fg-muted">Add to beacon</p>
      <select
        aria-label="Beacon"
        value={beaconId}
        onChange={(e) => setBeaconId(e.target.value)}
        className="mt-2 h-10 w-full rounded-md border border-line bg-void px-3 text-sm text-fg outline-none focus:border-brand"
      >
        <option value="">Select a beacon</option>
        {beacons.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-fg-subtle">Only beacons where you have Manage Beacon are shown.</p>
      {asked.length > 0 && (
        <>
          <p className="mt-6 text-xs font-semibold uppercase text-fg-muted">Grant {app.name} these permissions</p>
          <ul aria-label="Bot permissions" className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {asked.map((p) => (
              <li key={p.key}>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={granted.has(p.key)}
                    onChange={(e) =>
                      setGranted((g) => {
                        const next = new Set(g);
                        if (e.target.checked) next.add(p.key);
                        else next.delete(p.key);
                        return next;
                      })
                    }
                  />
                  {p.label}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={() => navigate('/channels/@me')}>
          Cancel
        </Button>
        <Button className="flex-1" isLoading={busy} disabled={!beaconId} onClick={() => void add()}>
          Authorize
        </Button>
      </div>
    </>
  );
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
  const botFlow = scopes.length === 1 && scopes[0] === 'bot';
  const requested = useMemo(() => {
    try {
      return BigInt(/^[0-9]{1,20}$/.test(params.get('permissions') ?? '') ? params.get('permissions')! : '0');
    } catch {
      return 0n;
    }
  }, [params]);

  useEffect(() => {
    if (botFlow) {
      http.get<{ application: AppInfo }>(`/oauth2/applications/${encodeURIComponent(clientId)}`).then(
        (r) => setApp(r.application),
        () => setError('This application does not exist.')
      );
      return;
    }
    if (params.get('response_type') !== 'code') return setError('This app asked in a way Subspace does not support (response_type must be code).');
    if (!scopes.length) return setError('This app did not say what it wants access to.');
    http.get<{ application: AppInfo }>(`/oauth2/applications/${encodeURIComponent(clientId)}`).then(
      (r) => setApp(r.application),
      () => setError('This application does not exist.')
    );
  }, [clientId, params, scopes.length, botFlow]);

  const authorize = async () => {
    setBusy(true);
    try {
      const { location } = await http.post<{ location: string }>('/oauth2/authorize', {
        clientId,
        redirectUri: params.get('redirect_uri') ?? '',
        scope: scopes.join(' '),
        ...(params.get('state') ? { state: params.get('state')! } : {}),
        // PKCE: S256 only. Without a method the spec means "plain", which the server refuses.
        ...(params.get('code_challenge') ? { codeChallenge: params.get('code_challenge')!, codeChallengeMethod: params.get('code_challenge_method') ?? 'plain' } : {}),
      });
      window.location.assign(location);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  /** Cancel: tell the app it was refused (to its registered redirect), or just leave. */
  const deny = async () => {
    const redirectUri = params.get('redirect_uri');
    if (redirectUri) {
      const r = await http
        .post<{ location: string }>('/oauth2/deny', { clientId, redirectUri, ...(params.get('state') ? { state: params.get('state')! } : {}) })
        .catch(() => null);
      if (r) return window.location.assign(r.location);
    }
    navigate('/channels/@me');
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
            <h1 className="flex items-center justify-center gap-2 text-center text-2xl font-bold text-fg">
              {app.name}
              {app.bot?.verified && <AppTag user={{ botKind: 'bot', botVerified: true }} />}
            </h1>
            {botFlow ? (
              <>
                <p className="text-center text-sm text-fg-muted">wants to join a beacon of yours as a bot</p>
                <AddBot app={app} requested={requested} />
              </>
            ) : (
            <>
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
              <Button variant="secondary" className="flex-1" onClick={() => void deny()}>
                Cancel
              </Button>
              <Button className="flex-1" isLoading={busy} onClick={() => void authorize()}>
                Authorize
              </Button>
            </div>
            </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
