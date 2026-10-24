import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Archive, Check, Copy, Download, FileText, Film, HardDrive, Image as ImageIcon, Music, Search, Trash2, Upload } from 'lucide-react';
import { Button, Modal, Tooltip } from '@subspace/ui';
import { api, type VaultFile, type VaultQuota } from '../../services/api';
import { uploadToVault } from '../../lib/uploads';
import { term } from '../../lib/strings';
import { confirmAction, toast } from '../../app/ui';

type Filter = 'all' | 'image' | 'video' | 'audio' | 'other';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'other', label: 'Files' },
];

const kind = (mime: string): Filter => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'other');

function formatBytes(bytes: number | string) {
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function FileIcon({ mime }: { mime: string }) {
  const Icon = mime.startsWith('image/') ? ImageIcon : mime.startsWith('video/') ? Film : mime.startsWith('audio/') ? Music : /zip|tar|compressed|7z|rar/.test(mime) ? Archive : FileText;
  return <Icon className="h-5 w-5 text-fg-muted" />;
}

const linkFor = (f: VaultFile) => f.downloadUrl || `/api/v1/vault/files/${f.id}/download`;

/** The personal file drive: storage use, upload, and every file with copy-link, download and delete. */
export function VaultModal({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<VaultFile[] | null>(null);
  const [quota, setQuota] = useState<VaultQuota | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async () => {
    const [q, list] = await Promise.all([api.getVaultQuota().catch(() => null), api.getVaultFiles().catch(() => [] as VaultFile[])]);
    setQuota(q);
    setFiles(list);
  };
  useEffect(() => {
    void load();
  }, []);

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      if (await uploadToVault(file)) await load();
    } catch (err) {
      toast(`Upload failed: ${(err as Error).message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const remove = (f: VaultFile) =>
    confirmAction({
      title: 'Delete File',
      body: `Delete ${f.filename}? Anywhere it was posted, the link will stop working.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await api.deleteVaultFile(f.id);
        await load();
      },
    });

  const copy = (f: VaultFile) => {
    void navigator.clipboard?.writeText(`${window.location.origin}${linkFor(f)}`);
    setCopied(f.id);
    setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 2000);
  };

  const shown = useMemo(
    () => (files ?? []).filter((f) => f.filename.toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || kind(f.mimeType) === filter)),
    [files, query, filter]
  );
  const used = quota && quota.quotaBytes > 0 ? Math.min(100, Math.round((quota.usedBytes / quota.quotaBytes) * 100)) : 0;
  const iconButton = 'flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg';

  return (
    <Modal isOpen onClose={onClose} title={term('vault')} description="Your uploaded files. Anyone with a file's link can open it." maxWidth="2xl">
      <div className="rounded-lg bg-raised p-4">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 shrink-0 text-fg-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">{quota ? `${formatBytes(quota.usedBytes)} of ${formatBytes(quota.quotaBytes)} used` : 'Checking storage…'}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-void" role="progressbar" aria-label="Storage used" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
              <div className={clsx('h-full rounded-full transition-[width]', used >= 90 ? 'bg-danger' : used >= 75 ? 'bg-warning' : 'bg-brand')} style={{ width: `${used}%` }} />
            </div>
          </div>
          <Button size="sm" isLoading={uploading} onClick={() => input.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" /> Upload
          </Button>
          <input
            ref={input}
            type="file"
            aria-label="Choose a file to upload"
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="File type" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={clsx('rounded-md px-2.5 py-1 text-sm font-medium', filter === f.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex h-8 w-56 items-center gap-2 rounded-md bg-void px-2.5">
          <Search className="h-4 w-4 text-fg-subtle" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" aria-label="Search files" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
        </label>
      </div>

      <div className="mt-3 h-[min(50vh,420px)] overflow-y-auto">
        {files === null ? (
          <p className="py-16 text-center text-sm text-fg-muted">Loading files…</p>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center">
            <HardDrive className="mx-auto h-10 w-10 text-fg-subtle" />
            <p className="mt-3 font-semibold text-fg">{files.length === 0 ? 'No files yet' : 'No files match'}</p>
            <p className="mt-1 text-sm text-fg-muted">{files.length === 0 ? 'Files you attach to transmissions appear here.' : 'Try a different search or file type.'}</p>
          </div>
        ) : (
          <ul aria-label="Files" className="divide-y divide-line">
            {shown.map((f) => (
              <li key={f.id} className="group flex items-center gap-3 px-1 py-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-raised">
                  <FileIcon mime={f.mimeType} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                    <span className="truncate">{f.filename}</span>
                    {f.isQuarantined && <span className="shrink-0 rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-danger">Quarantined</span>}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {formatBytes(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Tooltip content={copied === f.id ? 'Copied!' : 'Copy Link'}>
                    <button type="button" aria-label={`Copy link to ${f.filename}`} onClick={() => copy(f)} className={iconButton}>
                      {copied === f.id ? <Check className="h-4 w-4 text-online" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </Tooltip>
                  <Tooltip content="Download">
                    <a href={linkFor(f)} download={f.filename} aria-label={`Download ${f.filename}`} className={iconButton}>
                      <Download className="h-4 w-4" />
                    </a>
                  </Tooltip>
                  <Tooltip content="Delete">
                    <button type="button" aria-label={`Delete ${f.filename}`} onClick={() => remove(f)} className={clsx(iconButton, 'hover:text-danger')}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
