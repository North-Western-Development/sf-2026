import { useEffect, useState, type FormEvent } from 'react';
import { AppWindow, Copy, Plus, Trash2 } from 'lucide-react';
import { Button, Input, Modal } from '@subspace/ui';
import { http } from '../../../lib/http';
import { copyText } from '../../../lib/clipboard';
import { confirmAction, toast } from '../../../app/ui';
import { SettingsSection } from '../SettingsLayout';

/** What each scope lets an app do, in the words the consent page uses. */
export const SCOPE_TEXT: Record<string, string> = {
  identify: 'Know your username, tag and avatar',
  email: 'Know your email address',
  beacons: 'Know which beacons you are in',
};

interface Grant {
  id: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  application: { id: string; name: string; description: string | null; iconUrl: string | null; owner: string };
}

export function AppIcon({ name, iconUrl, size = 40 }: { name: string; iconUrl: string | null; size?: number }) {
  return iconUrl ? (
    <img src={iconUrl} alt="" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-brand-soft font-bold text-brand-sky" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** User Settings › Authorized Apps (Discord's): apps you let into your account, and Deauthorize. */
export function AuthorizedAppsTab() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  useEffect(() => {
    void http.get<{ grants: Grant[] }>('/users/@me/oauth2/grants').then((r) => setGrants(r.grants), () => setGrants([]));
  }, []);
  const deauthorize = (g: Grant) =>
    confirmAction({
      title: `Deauthorize ${g.application.name}`,
      body: `${g.application.name} will lose access to your account right away. You can authorize it again later.`,
      confirmLabel: 'Deauthorize',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/users/@me/oauth2/grants/${g.id}`);
        setGrants((list) => list?.filter((x) => x.id !== g.id) ?? null);
      },
    });
  return (
    <SettingsSection id="authorized-apps" title="Authorized Apps" description="Apps you have signed in to with Subspace.">
      {grants === null ? (
        <p className="text-sm text-fg-subtle">Loading…</p>
      ) : grants.length === 0 ? (
        <div className="py-8 text-center">
          <AppWindow className="mx-auto h-10 w-10 text-fg-subtle" />
          <p className="mt-3 font-semibold text-fg">No authorized apps</p>
          <p className="mt-1 text-sm text-fg-muted">Apps you sign in to with your Subspace account show up here.</p>
        </div>
      ) : (
        <ul aria-label="Authorized apps" className="space-y-3">
          {grants.map((g) => (
            <li key={g.id} className="rounded-lg bg-raised p-4 ring-1 ring-line">
              <div className="flex items-center gap-3">
                <AppIcon name={g.application.name} iconUrl={g.application.iconUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-fg">{g.application.name}</span>
                  <span className="block text-xs text-fg-muted">
                    by {g.application.owner} · authorized {new Date(g.createdAt).toLocaleDateString()}
                    {g.lastUsedAt ? ` · last used ${new Date(g.lastUsedAt).toLocaleDateString()}` : ''}
                  </span>
                </span>
                <Button size="sm" variant="danger" onClick={() => deauthorize(g)}>
                  Deauthorize
                </Button>
              </div>
              {g.application.description && <p className="mt-3 text-sm text-fg-muted">{g.application.description}</p>}
              <p className="mt-3 text-xs font-semibold uppercase text-fg-muted">Permissions</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-fg">
                {g.scopes.map((s) => (
                  <li key={s}>{SCOPE_TEXT[s] ?? s}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Developer Applications
// ---------------------------------------------------------------------------

interface DevApp {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  redirectUris: string[];
}

function SecretDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  return (
    <Modal isOpen onClose={onClose} title="Client Secret" description="Copy it now: it is shown only once. Reset it if it ever leaks." maxWidth="md">
      <div className="flex items-center gap-2">
        <code data-testid="client-secret" className="min-w-0 flex-1 truncate rounded-md bg-void px-3 py-2 font-mono text-sm text-fg">
          {secret}
        </code>
        <Button size="sm" onClick={() => void copyText(secret, 'Secret copied')}>
          Copy
        </Button>
      </div>
      <div className="-mx-6 -mb-4 mt-6 flex justify-end bg-raised px-6 py-4">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function AppEditor({ app, onSaved, onDeleted }: { app: DevApp; onSaved: (a: DevApp) => void; onDeleted: () => void }) {
  const [uris, setUris] = useState(app.redirectUris.join('\n'));
  const [secret, setSecret] = useState<string | null>(null);
  const save = async () => {
    try {
      const { application } = await http.patch<{ application: DevApp }>(`/applications/${app.id}`, { redirectUris: uris.split('\n').map((u) => u.trim()).filter(Boolean) });
      onSaved(application);
      toast('Redirect URIs saved', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <li className="rounded-lg bg-raised p-4 ring-1 ring-line" aria-label={app.name}>
      <div className="flex items-center gap-3">
        <AppIcon name={app.name} iconUrl={app.iconUrl} />
        <span className="min-w-0 flex-1 font-semibold text-fg">{app.name}</span>
        <button
          type="button"
          aria-label={`Delete ${app.name}`}
          onClick={() =>
            confirmAction({
              title: `Delete ${app.name}`,
              body: 'Everyone who authorized it loses it, and its credentials stop working.',
              confirmLabel: 'Delete',
              danger: true,
              onConfirm: async () => {
                await http.delete(`/applications/${app.id}`);
                onDeleted();
              },
            })
          }
          className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-xs font-semibold uppercase text-fg-muted">Client ID</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-void px-3 py-2 font-mono text-sm text-fg">{app.id}</code>
        <button type="button" aria-label="Copy Client ID" onClick={() => void copyText(app.id, 'Client ID copied')} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
          <Copy className="h-4 w-4" />
        </button>
      </div>
      <label className="mt-3 block text-xs font-semibold uppercase text-fg-muted">
        Redirect URIs (one per line)
        <textarea
          value={uris}
          onChange={(e) => setUris(e.target.value)}
          rows={3}
          className="mt-1 w-full resize-none rounded-md border border-line bg-void px-3 py-2 font-mono text-sm normal-case text-fg outline-none focus:border-brand"
        />
      </label>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => void save()}>
          Save Redirects
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            confirmAction({
              title: 'Reset Client Secret',
              body: 'The old secret stops working at once.',
              confirmLabel: 'Reset',
              danger: true,
              onConfirm: async () => setSecret((await http.post<{ clientSecret: string }>(`/applications/${app.id}/secret`)).clientSecret),
            })
          }
        >
          Reset Secret
        </Button>
      </div>
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </li>
  );
}

/** User Settings › Developer Applications: OAuth2 apps you build ("Sign in with Subspace"). */
export function DeveloperAppsTab() {
  const [apps, setApps] = useState<DevApp[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  useEffect(() => {
    void http.get<{ applications: DevApp[] }>('/applications').then((r) => setApps(r.applications), () => setApps([]));
  }, []);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await http.post<{ application: DevApp; clientSecret: string }>('/applications', { name: name.trim() });
      setApps((list) => [...(list ?? []), res.application]);
      setCreating(false);
      setName('');
      setSecret(res.clientSecret);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <SettingsSection
      id="developer-apps"
      title="Developer Applications"
      description="Build apps that people sign in to with Subspace (OAuth2). Send them to /oauth2/authorize with your Client ID, a registered redirect URI and scopes identify, email or beacons."
    >
      <Button size="sm" onClick={() => setCreating(true)}>
        <Plus className="mr-1 h-4 w-4" /> New Application
      </Button>
      {apps && apps.length > 0 && (
        <ul aria-label="Your applications" className="mt-4 space-y-3">
          {apps.map((a) => (
            <AppEditor
              key={a.id}
              app={a}
              onSaved={(next) => setApps((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null)}
              onDeleted={() => setApps((list) => list?.filter((x) => x.id !== a.id) ?? null)}
            />
          ))}
        </ul>
      )}
      {creating && (
        <Modal isOpen onClose={() => setCreating(false)} title="Create an Application" maxWidth="md">
          <form onSubmit={create} className="space-y-4">
            <Input label="Name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} autoFocus required />
            <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
              <Button variant="link" className="text-fg" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={name.trim().length < 2}>
                Create
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </SettingsSection>
  );
}
