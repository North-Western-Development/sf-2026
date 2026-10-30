import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { http } from '../../../lib/http';
import { confirmAction, toast } from '../../../app/ui';
import { SettingsSection, Switch } from '../SettingsLayout';

export type ConnectionProvider = 'github' | 'google' | 'microsoft' | 'dropbox' | 'steam';

export interface Connection {
  id: string;
  provider: ConnectionProvider;
  name: string;
  url: string | null;
  visible: boolean;
}

/** Each provider's mark: its initial on its brand colour (no third-party logo files). */
const MARK: Record<ConnectionProvider, { name: string; bg: string; fg: string; letter: string }> = {
  github: { name: 'GitHub', bg: '#24292F', fg: '#FFFFFF', letter: 'G' },
  google: { name: 'Google', bg: '#FFFFFF', fg: '#4285F4', letter: 'G' },
  microsoft: { name: 'Microsoft', bg: '#2F2F2F', fg: '#7FBA00', letter: 'M' },
  dropbox: { name: 'Dropbox', bg: '#0061FE', fg: '#FFFFFF', letter: 'D' },
  steam: { name: 'Steam', bg: '#171A21', fg: '#66C0F4', letter: 'S' },
};

export function ProviderMark({ provider, size = 32 }: { provider: ConnectionProvider; size?: number }) {
  const m = MARK[provider];
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg font-bold ring-1 ring-line"
      style={{ width: size, height: size, background: m.bg, color: m.fg, fontSize: size * 0.5 }}
    >
      {m.letter}
    </span>
  );
}

/** Sign in with the provider in a popup; resolves when the popup reports back. */
function signInPopup(url: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const popup = window.open(url, 'subspace-connection', 'width=520,height=680');
    const done = (r: { ok: boolean; message: string }) => {
      window.removeEventListener('message', onMessage);
      clearInterval(closed);
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === 'subspace-connection') done({ ok: !!e.data.ok, message: String(e.data.message ?? '') });
    };
    window.addEventListener('message', onMessage);
    const closed = window.setInterval(() => popup?.closed && done({ ok: false, message: '' }), 500);
  });
}

/** User Settings › Connections (Discord's): link accounts and choose which show on your profile. */
export function ConnectionsTab() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [providers, setProviders] = useState<Array<{ provider: ConnectionProvider; name: string; available: boolean }>>([]);
  // A reload that started before a change here (disconnecting, say) would put back what it removed.
  const changes = useRef(0);
  const load = () => {
    const at = changes.current;
    return http.get<{ connections: Connection[]; providers: typeof providers }>('/users/@me/connections').then(
      (r) => {
        if (at !== changes.current) return;
        setConnections(r.connections);
        setProviders(r.providers);
      },
      (e) => toast((e as Error).message, 'error')
    );
  };
  useEffect(() => {
    void load();
  }, []);

  const add = async (provider: ConnectionProvider) => {
    try {
      const { url } = await http.post<{ url: string }>(`/users/@me/connections/${provider}/authorize`);
      const result = await signInPopup(url);
      if (result.message) toast(result.message, result.ok ? 'success' : 'error');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const setVisible = async (c: Connection, visible: boolean) => {
    changes.current++;
    setConnections((list) => list?.map((x) => (x.id === c.id ? { ...x, visible } : x)) ?? null);
    await http.patch(`/users/@me/connections/${c.id}`, { visible }).catch((e) => {
      toast((e as Error).message, 'error');
      void load();
    });
  };
  const remove = (c: Connection) =>
    confirmAction({
      title: `Disconnect ${MARK[c.provider].name}`,
      body: `Remove ${c.name} from your connections? It will no longer show on your profile.`,
      confirmLabel: 'Disconnect',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/users/@me/connections/${c.id}`);
        changes.current++;
        setConnections((list) => list?.filter((x) => x.id !== c.id) ?? null);
      },
    });

  return (
    <>
      <SettingsSection id="add-connections" title="Add accounts to your profile" description="Connected accounts can show on your profile. Subspace only learns your public name on them.">
        <div className="flex flex-wrap gap-3" aria-label="Providers">
          {providers.map((p) => (
            <button
              key={p.provider}
              type="button"
              disabled={!p.available}
              title={p.available ? `Connect ${p.name}` : `${p.name} is not set up on this server`}
              aria-label={`Connect ${p.name}`}
              onClick={() => void add(p.provider)}
              className="rounded-lg p-1 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ProviderMark provider={p.provider} size={44} />
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection id="your-connections" title="Your Connections">
        {connections === null ? (
          <p className="text-sm text-fg-subtle">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-fg-subtle">No accounts connected yet.</p>
        ) : (
          <ul aria-label="Your connections" className="space-y-3">
            {connections.map((c) => (
              <li key={c.id} className="rounded-lg bg-raised p-4 ring-1 ring-line">
                <div className="flex items-center gap-3">
                  <ProviderMark provider={c.provider} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg">{c.name}</span>
                    <span className="block text-xs text-fg-muted">{MARK[c.provider].name}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Disconnect ${MARK[c.provider].name} ${c.name}`}
                    onClick={() => remove(c)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-danger"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 border-t border-line pt-3">
                  <Switch label="Display on profile" checked={c.visible} onChange={(v) => void setVisible(c, v)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </>
  );
}

/** Profile › Connections: the accounts they chose to show. */
export function ProfileConnections({ connections, heading }: { connections?: Array<{ provider: ConnectionProvider; name: string; url: string | null }>; heading: string }) {
  if (!connections?.length) return null;
  return (
    <section>
      <h4 className={heading}>Connections</h4>
      <ul aria-label="Connections" className="grid gap-2 sm:grid-cols-2">
        {connections.map((c) => (
          <li key={`${c.provider}-${c.name}`} className="flex items-center gap-2 rounded-md bg-raised p-2">
            <ProviderMark provider={c.provider} size={28} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{c.name}</span>
            {c.url && (
              <a href={c.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${c.name} on ${MARK[c.provider].name}`} className="text-fg-muted hover:text-fg">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
