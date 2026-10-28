import { useEffect, useState, type FormEvent } from 'react';
import { uploadMedia } from '../../../lib/media';
import { AppWindow, Bot, Copy, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { Button, Input, Modal } from '@subspace/ui';
import { http } from '../../../lib/http';
import { copyText } from '../../../lib/clipboard';
import { confirmAction, toast } from '../../../app/ui';
import { SettingsSection } from '../SettingsLayout';
import { PERMISSIONS } from '../../../data/permissions';
import { DEV_TEAM_ROLE_INFO, PRIVILEGED_INTENT_INFO, appRoleAtLeast, type AppRole, type PrivilegedIntent } from '@subspace/constants';
import { TeamsSection, type Invitation, type Team } from './TeamsSection';
import { ActivitySection } from './ActivitySection';

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
  /** The development team it belongs to, and what I may do with it. */
  teamId: string | null;
  role: AppRole;
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

/** What this instance lets me do as a developer (Command Console › Developers). */
interface DeveloperPolicyView {
  verification: { email: boolean; phone: boolean; staff: boolean; verified: boolean };
  verifiedMeans: string;
  createApps: { allowed: boolean; missing: string[] };
  intents: Record<PrivilegedIntent, { allowed: boolean; audience: 'everyone' | 'verified' }>;
}

function useDeveloperPolicy() {
  const [policy, setPolicy] = useState<DeveloperPolicyView | null>(null);
  useEffect(() => {
    void http.get<DeveloperPolicyView>('/applications/policy').then(setPolicy, () => setPolicy(null));
  }, []);
  return policy;
}

interface AppBot {
  userId: string;
  isPublic: boolean;
  messageContent: boolean;
  activityIntent: boolean;
  interactionsUrl: string | null;
  publicKey: string;
  token?: string;
}

function CopyRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <>
      <p className="mt-3 text-xs font-semibold uppercase text-fg-muted">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code data-testid={testId} className="min-w-0 flex-1 truncate rounded-md bg-void px-3 py-2 font-mono text-sm text-fg">
          {value}
        </code>
        <button type="button" aria-label={`Copy ${label}`} onClick={() => void copyText(value, `${label} copied`)} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

function Toggle({ label, hint, checked, onChange, disabled, note }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; note?: string }) {
  return (
    <label className="mt-3 flex items-start gap-3">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="block text-xs text-fg-subtle">{hint}</span>
        {note && <span className="mt-0.5 block text-xs text-warning">{note}</span>}
      </span>
    </label>
  );
}

const INTENT_FIELD: Record<PrivilegedIntent, 'messageContent' | 'activityIntent'> = { messageContent: 'messageContent', activity: 'activityIntent' };

/** The permissions the invite link asks for by default; whoever adds the bot can untick any. */
const DEFAULT_BOT_PERMISSIONS = PERMISSIONS.VIEW_RELAY | PERMISSIONS.SEND_TRANSMISSIONS | PERMISSIONS.READ_HISTORY | PERMISSIONS.ADD_REACTIONS | PERMISSIONS.EMBED_LINKS;

/** An app's bot: its token, who can add it, what it can read, and where interactions go. */
function BotSection({ app }: { app: DevApp }) {
  const policy = useDeveloperPolicy();
  const [bot, setBot] = useState<AppBot | null | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    void http.get<{ bot: AppBot | null }>(`/applications/${app.id}/bot`).then(
      (r) => {
        setBot(r.bot);
        setUrl(r.bot?.interactionsUrl ?? '');
      },
      () => setBot(null)
    );
  }, [app.id]);
  const patch = async (body: Partial<AppBot>) => {
    try {
      const r = await http.patch<{ bot: AppBot }>(`/applications/${app.id}/bot`, body);
      setBot(r.bot);
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
  };
  if (bot === undefined) return null;
  if (!bot)
    return (
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-xs font-semibold uppercase text-fg-muted">Bot</p>
        <p className="mt-1 text-sm text-fg-subtle">Give the app a bot account: it can join beacons, post, and answer slash commands.</p>
        <Button
          size="sm"
          className="mt-2"
          onClick={async () => {
            try {
              const r = await http.post<{ bot: AppBot }>(`/applications/${app.id}/bot`);
              setBot(r.bot);
              setToken(r.bot.token ?? null);
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        >
          <Bot className="mr-1 h-4 w-4" /> Add Bot
        </Button>
      </div>
    );
  const invite = `${window.location.origin}/oauth2/authorize?client_id=${app.id}&scope=bot&permissions=${DEFAULT_BOT_PERMISSIONS.toString()}`;
  return (
    <section aria-label="Bot" className="mt-4 border-t border-line pt-4">
      <p className="text-xs font-semibold uppercase text-fg-muted">Bot</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            confirmAction({
              title: 'Reset Bot Token',
              body: 'The old token stops working at once, and the bot disconnects.',
              confirmLabel: 'Reset',
              danger: true,
              onConfirm: async () => setToken((await http.post<{ bot: AppBot }>(`/applications/${app.id}/bot/reset-token`)).bot.token ?? null),
            })
          }
        >
          Reset Token
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            confirmAction({
              title: 'Delete Bot',
              body: 'It leaves every beacon it is in, and its token stops working.',
              confirmLabel: 'Delete',
              danger: true,
              onConfirm: async () => {
                await http.delete(`/applications/${app.id}/bot`);
                setBot(null);
              },
            })
          }
        >
          Delete Bot
        </Button>
      </div>
      <Toggle label="Public Bot" hint="Anyone with the invite link can add it. Off: only you." checked={bot.isPublic} onChange={(v) => void patch({ isPublic: v })} />
      {(Object.keys(INTENT_FIELD) as PrivilegedIntent[]).map((intent) => {
        const field = INTENT_FIELD[intent];
        const allowed = policy?.intents[intent].allowed ?? true;
        return (
          <Toggle
            key={intent}
            label={`${PRIVILEGED_INTENT_INFO[intent].label} Intent`}
            hint={intent === 'messageContent' ? 'Read the text of every message it can see. Off: only messages that mention it, and its own.' : PRIVILEGED_INTENT_INFO[intent].description}
            checked={bot[field]}
            // Turning one off is always possible.
            disabled={!allowed && !bot[field]}
            note={allowed ? undefined : `${bot[field] ? 'Not active: on this instance it' : 'On this instance it'} needs a verified account: ${policy?.verifiedMeans}.`}
            onChange={(v) => void patch({ [field]: v })}
          />
        );
      })}
      <label className="mt-3 block text-xs font-semibold uppercase text-fg-muted">
        Interactions Endpoint URL
        <div className="mt-1 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/interactions (blank: over the gateway)"
            className="h-9 min-w-0 flex-1 rounded-md border border-line bg-void px-3 font-mono text-sm normal-case text-fg outline-none focus:border-brand"
          />
          <Button size="sm" onClick={() => void patch({ interactionsUrl: url.trim() || null }).then((ok) => ok && toast('Endpoint saved', 'success'))}>
            Save
          </Button>
        </div>
      </label>
      <CopyRow label="Public Key" value={bot.publicKey} />
      <CopyRow label="Invite Link" value={invite} testId="bot-invite" />
      {token && (
        <Modal isOpen onClose={() => setToken(null)} title="Bot Token" description="Copy it now: it is shown only once. Anyone with it controls the bot; reset it if it leaks." maxWidth="md">
          <div className="flex items-center gap-2">
            <code data-testid="bot-token" className="min-w-0 flex-1 truncate rounded-md bg-void px-3 py-2 font-mono text-sm text-fg">
              {token}
            </code>
            <Button size="sm" onClick={() => void copyText(token, 'Token copied')}>
              Copy
            </Button>
          </div>
          <div className="-mx-6 -mb-4 mt-6 flex justify-end bg-raised px-6 py-4">
            <Button onClick={() => setToken(null)}>Done</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function AppEditor({ app, teams, onSaved, onDeleted }: { app: DevApp; teams: Team[]; onSaved: (a: DevApp) => void; onDeleted: () => void }) {
  const [uris, setUris] = useState(app.redirectUris.join('\n'));
  const team = teams.find((t) => t.id === app.teamId);
  const canEdit = appRoleAtLeast(app.role, 'developer');
  // Into a team: its owner, to a team they admin. Out of one: the team's owner.
  const moveTargets = app.teamId ? [] : teams.filter((t) => appRoleAtLeast(t.myRole, 'admin'));
  const move = async (teamId: string | null) => {
    try {
      await http.post(`/applications/${app.id}/team`, { teamId });
      onSaved({ ...app, teamId, role: teamId ? (teams.find((t) => t.id === teamId)?.myRole ?? 'owner') : 'owner' });
      toast(teamId ? `Moved into ${teams.find((t) => t.id === teamId)?.name}` : 'Moved out of the team', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
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
        {canEdit ? (
          <label className="relative cursor-pointer" title="Change icon">
            <AppIcon name={app.name} iconUrl={app.iconUrl} />
            <span className="absolute -bottom-1 -right-1 rounded-full bg-overlay p-0.5 text-fg-muted ring-1 ring-line">
              <Pencil className="h-3 w-3" aria-hidden />
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              aria-label={`Icon for ${app.name}`}
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const iconUrl = await uploadMedia('app_icon', file);
                  const { application } = await http.patch<{ application: DevApp }>(`/applications/${app.id}`, { iconUrl });
                  onSaved(application);
                  toast('Icon saved', 'success');
                } catch (err) {
                  toast((err as Error).message, 'error');
                }
              }}
            />
          </label>
        ) : (
          <AppIcon name={app.name} iconUrl={app.iconUrl} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-fg">{app.name}</span>
          {team && (
            <span className="block text-xs text-fg-muted">
              {team.name} · {app.role === 'owner' ? 'Owner' : DEV_TEAM_ROLE_INFO[app.role].label}
            </span>
          )}
        </span>
        {app.role === 'owner' && moveTargets.length > 0 && (
          <select aria-label={`Move ${app.name} to a team`} value="" onChange={(e) => e.target.value && void move(e.target.value)} className="h-8 rounded-md border border-line bg-void px-2 text-xs text-fg">
            <option value="">Move to team…</option>
            {moveTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {app.teamId && team?.myRole === 'owner' && (
          <Button size="sm" variant="secondary" onClick={() => void move(null)}>
            Move Out of Team
          </Button>
        )}
        {appRoleAtLeast(app.role, 'admin') && (
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
        )}
      </div>
      {!canEdit && <p className="mt-2 text-xs text-fg-subtle">Read-only: you can see this application, but not change it or see its secrets.</p>}
      <p className="mt-3 text-xs font-semibold uppercase text-fg-muted">Client ID</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-void px-3 py-2 font-mono text-sm text-fg">{app.id}</code>
        <button type="button" aria-label="Copy Client ID" onClick={() => void copyText(app.id, 'Client ID copied')} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
          <Copy className="h-4 w-4" />
        </button>
      </div>
      {/* Read-only team members see everything below but change nothing. */}
      <fieldset disabled={!canEdit} className="disabled:opacity-70">
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
      <BotSection app={app} />
      <ActivitySection appId={app.id} appName={app.name} />
      </fieldset>
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </li>
  );
}

/** User Settings › Developer Applications: OAuth2 apps you build ("Sign in with Subspace"). */
export function DeveloperAppsTab() {
  const policy = useDeveloperPolicy();
  const [apps, setApps] = useState<DevApp[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const loadApps = () => void http.get<{ applications: DevApp[] }>('/applications').then((r) => setApps(r.applications), () => setApps([]));
  useEffect(() => {
    loadApps();
    void http.get<{ teams: Team[]; invitations: Invitation[] }>('/teams').then(
      (r) => {
        setTeams(r.teams);
        setInvitations(r.invitations);
      },
      () => {}
    );
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
      description="Build apps that people sign in to with Subspace (OAuth2), and bots that join beacons and answer slash commands. Sign-in: send people to /oauth2/authorize with your Client ID, a registered redirect URI and scopes identify, email or beacons."
    >
      {policy && !policy.createApps.allowed && (
        <p role="note" className="mb-3 flex gap-2 rounded-md bg-raised px-3 py-2.5 text-sm text-fg-muted ring-1 ring-line">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>
            Creating applications on this instance needs {policy.createApps.missing.join(' and ')}. Verify your email or phone in My Account
            {policy.verifiedMeans.includes('staff') ? ', or ask the instance staff to verify your account' : ''}.
          </span>
        </p>
      )}
      <Button size="sm" disabled={policy ? !policy.createApps.allowed : false} onClick={() => setCreating(true)}>
        <Plus className="mr-1 h-4 w-4" /> New Application
      </Button>
      {apps && apps.length > 0 && (
        <ul aria-label="Your applications" className="mt-4 space-y-3">
          {apps.map((a) => (
            <AppEditor
              key={a.id}
              app={a}
              teams={teams}
              onSaved={(next) => setApps((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null)}
              onDeleted={() => setApps((list) => list?.filter((x) => x.id !== a.id) ?? null)}
            />
          ))}
        </ul>
      )}
      <TeamsSection
        teams={teams}
        invitations={invitations}
        // Joining or leaving a team changes which applications are mine to see.
        onTeams={(next) => {
          setTeams(next);
          loadApps();
        }}
        onInvitations={setInvitations}
        canCreate={policy ? policy.createApps.allowed : true}
      />
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
