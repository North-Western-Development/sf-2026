import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronRight, Cloud, FileText, Folder, Image as ImageIcon, Film, LogOut, Search } from 'lucide-react';
import { Button, Tooltip } from '@subspace/ui';
import { http, ApiError } from '../../lib/http';
import { withUploadDisclaimer } from '../../lib/uploads';
import type { VaultFile } from '../../services/api';
import { confirmAction, toast } from '../../app/ui';

export type DriveProvider = 'google' | 'onedrive' | 'dropbox';

export interface DriveStatus {
  provider: DriveProvider;
  name: string;
  configured: boolean;
  connected: boolean;
  accountLabel: string | null;
}

interface DriveItem {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType?: string;
  size?: number;
  modifiedAt?: string;
  importable: boolean;
}

const TINT: Record<DriveProvider, string> = { google: '#3DDC84', onedrive: '#3DCBFF', dropbox: '#3B8EF2' };

function formatBytes(b?: number) {
  if (b === undefined) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function ItemIcon({ item }: { item: DriveItem }) {
  if (item.isFolder) return <Folder className="h-5 w-5 text-brand-sky" />;
  const m = item.mimeType ?? '';
  const Icon = m.startsWith('image/') ? ImageIcon : m.startsWith('video/') ? Film : FileText;
  return <Icon className="h-5 w-5 text-fg-muted" />;
}

/** Open the provider's consent screen in a popup; resolves once the popup reports back or closes. */
function signInPopup(url: string): Promise<void> {
  return new Promise((resolve) => {
    const popup = window.open(url, 'subspace-drive', 'width=520,height=680');
    const done = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(timer);
      resolve();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === 'subspace-drive') {
        if (!e.data.ok) toast(e.data.message, 'error');
        done();
      }
    };
    window.addEventListener('message', onMessage);
    const timer = setInterval(() => (!popup || popup.closed) && done(), 500);
  });
}

export function useDrives() {
  const [drives, setDrives] = useState<DriveStatus[] | null>(null);
  const reload = useCallback(() => http.get<{ drives: DriveStatus[] }>('/vault/drives').then((r) => setDrives(r.drives), () => setDrives([])), []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const connect = async (provider: DriveProvider) => {
    try {
      const { url } = await http.post<{ url: string }>(`/vault/drives/${provider}/connect`);
      await signInPopup(url);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    await reload();
  };
  const disconnect = (d: DriveStatus) =>
    confirmAction({
      title: `Disconnect ${d.name}`,
      body: `Subspace will forget its access to ${d.accountLabel ?? 'this account'}. Files you already imported stay in your vault.`,
      confirmLabel: 'Disconnect',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/vault/drives/${d.provider}`);
        await reload();
      },
    });
  return { drives, reload, connect, disconnect };
}

/** Connect cards for every drive this instance supports. */
function DriveCards({ drives, connect, disconnect, open }: { drives: DriveStatus[]; connect: (p: DriveProvider) => void; disconnect: (d: DriveStatus) => void; open: (p: DriveProvider) => void }) {
  return (
    <ul aria-label="Cloud drives" className="grid gap-2">
      {drives.map((d) => (
        <li key={d.provider} className={clsx('flex items-center gap-3 rounded-lg bg-raised p-3', !d.configured && 'opacity-50')}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-void" style={{ color: TINT[d.provider] }}>
            <Cloud className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-fg">{d.name}</p>
            <p className="truncate text-xs text-fg-muted">{!d.configured ? 'Not set up on this instance' : d.connected ? d.accountLabel ?? 'Connected' : 'Not connected'}</p>
          </div>
          {d.configured &&
            (d.connected ? (
              <>
                <Button size="sm" onClick={() => open(d.provider)}>
                  Browse
                </Button>
                <Tooltip content="Disconnect">
                  <button type="button" aria-label={`Disconnect ${d.name}`} onClick={() => disconnect(d)} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-danger">
                    <LogOut className="h-4 w-4" />
                  </button>
                </Tooltip>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => connect(d.provider)}>
                Connect
              </Button>
            ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * Browse a connected cloud drive and copy files into the vault. `actionLabel` is "Import" in
 * the vault and "Attach" when picking for a transmission.
 */
export function DriveBrowser({ actionLabel = 'Import', onImported }: { actionLabel?: string; onImported: (file: VaultFile) => void }) {
  const { drives, connect, disconnect } = useDrives();
  const [provider, setProvider] = useState<DriveProvider | null>(null);
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([]);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DriveItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drive = drives?.find((d) => d.provider === provider);

  const load = useCallback(
    async (opts: { folderId?: string; q?: string; cursor?: string } = {}) => {
      if (!provider) return;
      setError(null);
      if (!opts.cursor) setItems(null);
      const params = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as Array<[string, string]>);
      try {
        const r = await http.get<{ items: DriveItem[]; cursor?: string | null }>(`/vault/drives/${provider}/files?${params}`);
        setItems((prev) => (opts.cursor ? [...(prev ?? []), ...r.items] : r.items));
        setCursor(r.cursor ?? null);
      } catch (err) {
        setItems([]);
        setError((err as Error).message);
      }
    },
    [provider]
  );

  useEffect(() => {
    setPath([]);
    setQuery('');
    void load();
  }, [load]);

  const folderId = path.at(-1)?.id;
  const openFolder = (item: DriveItem) => {
    setPath((p) => [...p, { id: item.id, name: item.name }]);
    setQuery('');
    void load({ folderId: item.id });
  };
  const goTo = (depth: number) => {
    const next = path.slice(0, depth);
    setPath(next);
    setQuery('');
    void load({ folderId: next.at(-1)?.id });
  };
  const search = (q: string) => {
    setQuery(q);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(q.trim() ? { q: q.trim() } : { folderId }), 300);
  };

  const importItem = async (item: DriveItem) => {
    setBusy(item.id);
    try {
      const res = await withUploadDisclaimer(() => http.post<{ file: VaultFile }>(`/vault/drives/${provider}/import`, { fileId: item.id }));
      if (res) onImported(res.file);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Import failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!drives) return <p className="py-16 text-center text-sm text-fg-muted">Loading drives…</p>;

  if (!provider || !drive?.connected) {
    return (
      <div>
        <p className="mb-3 text-sm text-fg-muted">Connect a cloud drive to copy files from it into your vault. Subspace only reads the files you pick.</p>
        <DriveCards drives={drives} connect={(p) => void connect(p)} disconnect={disconnect} open={setProvider} />
      </div>
    );
  }

  return (
    <div className="flex h-[min(50vh,420px)] flex-col">
      <div className="flex items-center gap-2">
        <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <button type="button" onClick={() => setProvider(null)} className="shrink-0 text-fg-muted hover:text-fg hover:underline">
            Drives
          </button>
          <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" />
          <button type="button" onClick={() => goTo(0)} className={clsx('shrink-0 hover:underline', path.length ? 'text-fg-muted hover:text-fg' : 'font-semibold text-fg')}>
            {drive.name}
          </button>
          {path.map((p, i) => (
            <span key={p.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" />
              <button type="button" onClick={() => goTo(i + 1)} className={clsx('truncate hover:underline', i === path.length - 1 ? 'font-semibold text-fg' : 'text-fg-muted hover:text-fg')}>
                {p.name}
              </button>
            </span>
          ))}
        </nav>
        <label className="flex h-8 w-48 items-center gap-2 rounded-md bg-void px-2.5">
          <Search className="h-4 w-4 text-fg-subtle" />
          <input value={query} onChange={(e) => search(e.target.value)} placeholder={`Search ${drive.name}`} aria-label={`Search ${drive.name}`} className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
        </label>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto" aria-busy={items === null}>
        {items === null ? (
          <p className="py-16 text-center text-sm text-fg-muted">Loading…</p>
        ) : error ? (
          <p className="py-16 text-center text-sm text-danger">{error}</p>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-muted">{query ? 'Nothing matches that search.' : 'This folder is empty.'}</p>
        ) : (
          <ul aria-label={`Files in ${path.at(-1)?.name ?? drive.name}`} className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className={clsx('flex items-center gap-3 px-1 py-2', !item.isFolder && !item.importable && 'opacity-50')}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-raised">
                  <ItemIcon item={item} />
                </span>
                {item.isFolder ? (
                  <button type="button" onClick={() => openFolder(item)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg hover:underline">
                    {item.name}
                  </button>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{item.name}</p>
                    <p className="text-xs text-fg-muted">
                      {[formatBytes(item.size), item.modifiedAt && new Date(item.modifiedAt).toLocaleDateString()].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                )}
                {!item.isFolder &&
                  (item.importable ? (
                    <Button size="sm" variant="secondary" isLoading={busy === item.id} disabled={!!busy} onClick={() => void importItem(item)} aria-label={`${actionLabel} ${item.name}`}>
                      {actionLabel}
                    </Button>
                  ) : (
                    <span className="text-xs text-fg-subtle">Can't import</span>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {cursor && items && (
          <button type="button" onClick={() => void load({ cursor, folderId, q: query.trim() || undefined })} className="mx-auto mt-3 flex items-center gap-1 text-sm text-brand-sky hover:underline">
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
