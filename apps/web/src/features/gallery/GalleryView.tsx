import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Image as ImageIcon, Play, Trash2, Upload, X } from 'lucide-react';
import { Button, Modal, Tooltip } from '@subspace/ui';
import { useStore } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { ackChannel } from '../../data/actions';
import { gateway } from '../../services/gateway';
import { http } from '../../lib/http';
import { uploadToVault } from '../../lib/uploads';
import { toUserRef } from '../../lib/normalize';
import { formatMessageTime } from '../../lib/time';
import { channelKey, type Relay, type UserRef } from '../../lib/types';
import { confirmAction, toast } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { toPlainText } from '../chat/markdown';

interface GalleryItem {
  key: string;
  transmissionId: string;
  url: string;
  filename: string;
  size: number;
  video: boolean;
  caption: string;
  author: UserRef;
  createdAt: string;
}

const isVideo = (mime?: string, name = '') => (mime ? mime.startsWith('video/') : /\.(mp4|webm|mov|m4v)$/i.test(name));
const ACCEPT = 'image/*,video/*';

function toItems(gallery: any[]): GalleryItem[] {
  return gallery.map((g, i) => ({
    key: `${g.transmissionId}-${g.attachment?.id ?? i}`,
    transmissionId: g.transmissionId,
    url: g.attachment?.url,
    filename: g.attachment?.filename || 'Untitled',
    size: g.attachment?.size ?? 0,
    video: isVideo(g.attachment?.mimeType, g.attachment?.filename),
    caption: g.caption || '',
    author: toUserRef(g.author ?? {}),
    createdAt: g.createdAt,
  }));
}

function formatSize(bytes: number) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Upload dialog: a preview of the chosen file plus an optional caption, like Discord's attachment modal. */
function UploadDialog({ relay, file, onClose, onPosted }: { relay: Relay; file: File; onClose: () => void; onPosted: () => void }) {
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const uploaded = await uploadToVault(file);
      if (!uploaded) return;
      await http.post(`/relays/${relay.id}/visual/transmissions`, { content: caption.trim(), attachmentIds: [uploaded.id] });
      onPosted();
      onClose();
    } catch (err) {
      toast((err as Error).message || 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Upload to #${relay.name}`} maxWidth="lg">
      <form onSubmit={submit}>
        <div className="flex max-h-[50vh] items-center justify-center overflow-hidden rounded-lg bg-void">
          {file.type.startsWith('video/') ? (
            <video src={preview} className="max-h-[50vh] w-auto" muted controls aria-label="Upload preview" />
          ) : (
            <img src={preview} alt="Upload preview" className="max-h-[50vh] w-auto object-contain" />
          )}
        </div>
        <p className="mt-2 truncate text-xs text-fg-muted">
          {file.name} · {formatSize(file.size)}
        </p>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-fg-muted">Caption</span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={2000}
            rows={3}
            aria-label="Caption"
            placeholder="Add a caption (optional)"
            className="w-full resize-none rounded-md bg-void px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:ring-2 focus:ring-brand"
          />
        </label>
        <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            Upload
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Full-screen viewer with previous/next, download and delete. */
function Lightbox({
  items,
  index,
  onIndex,
  onClose,
  canDelete,
  onDelete,
}: {
  items: GalleryItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  canDelete: (item: GalleryItem) => boolean;
  onDelete: (item: GalleryItem) => void;
}) {
  const item = items[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onIndex, onClose]);
  if (!item) return null;

  const iconButton = 'flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-white/10 hover:text-fg';
  return (
    <div role="dialog" aria-modal="true" aria-label={item.caption || item.filename} className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex h-14 shrink-0 items-center gap-3 px-4" onClick={(e) => e.stopPropagation()}>
        <Avatar user={item.author} size={32} />
        <div className="min-w-0 flex-1">
          <UserName user={item.author} className="block truncate text-sm font-semibold" />
          <p className="text-xs text-fg-muted">{formatMessageTime(item.createdAt)}</p>
        </div>
        <Tooltip content="Download" placement="bottom">
          <a href={item.url} download={item.filename} aria-label="Download" className={iconButton}>
            <Download className="h-5 w-5" />
          </a>
        </Tooltip>
        <Tooltip content="Open in Browser" placement="bottom">
          <a href={item.url} target="_blank" rel="noreferrer noopener" aria-label="Open in Browser" className={iconButton}>
            <ExternalLink className="h-5 w-5" />
          </a>
        </Tooltip>
        {canDelete(item) && (
          <Tooltip content="Delete" placement="bottom">
            <button type="button" aria-label="Delete" onClick={() => onDelete(item)} className={clsx(iconButton, 'hover:text-danger')}>
              <Trash2 className="h-5 w-5" />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Close" placement="bottom">
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className={iconButton}>
            <X className="h-6 w-6" />
          </button>
        </Tooltip>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-4">
        {index > 0 && (
          <button
            type="button"
            aria-label="Previous"
            onClick={(e) => {
              e.stopPropagation();
              onIndex(index - 1);
            }}
            className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-full bg-raised/80 text-fg hover:bg-raised"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {item.video ? (
          <video key={item.key} src={item.url} controls autoPlay className="max-h-full max-w-full rounded-md" onClick={(e) => e.stopPropagation()} />
        ) : (
          <img key={item.key} src={item.url} alt={item.caption || item.filename} className="max-h-full max-w-full rounded-md object-contain" onClick={(e) => e.stopPropagation()} />
        )}
        {index < items.length - 1 && (
          <button
            type="button"
            aria-label="Next"
            onClick={(e) => {
              e.stopPropagation();
              onIndex(index + 1);
            }}
            className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-full bg-raised/80 text-fg hover:bg-raised"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
      {item.caption && (
        <p className="mx-auto mb-6 max-w-2xl shrink-0 whitespace-pre-wrap px-4 text-center text-sm text-fg" onClick={(e) => e.stopPropagation()}>
          {item.caption}
        </p>
      )}
    </div>
  );
}

export function GalleryView({ relay }: { relay: Relay }) {
  const meId = useStore((s) => s.me?.id);
  const perms = useStore((s) => relayPermissions(s, relay.id));
  const canPost = can(perms, PERMISSIONS.SEND_TRANSMISSIONS) && can(perms, PERMISSIONS.ATTACH_FILES);
  const canModerate = can(perms, PERMISSIONS.MANAGE_TRANSMISSIONS);
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const key = channelKey('relay', relay.id);

  const load = useCallback(
    () =>
      http
        .get<{ gallery: any[] }>(`/relays/${relay.id}/visual/gallery`)
        .then((r) => setItems(toItems(r.gallery ?? [])))
        .catch((err) => {
          setItems((list) => list ?? []);
          toast((err as Error).message, 'error');
        }),
    [relay.id]
  );

  useEffect(() => {
    void load();
    void ackChannel(key).catch(() => {});
  }, [load, key]);

  // Posts and deletions by anyone show up live.
  useEffect(
    () =>
      gateway.onDispatch((type, d) => {
        // READY: catch up on anything posted or deleted while the socket was (re)connecting.
        if (type === 'READY') void load();
        else if ((type === 'TRANSMISSION_CREATE' || type === 'TRANSMISSION_DELETE') && (d?.relay_id ?? d?.relayId) === relay.id) {
          void load();
          if (type === 'TRANSMISSION_CREATE') void ackChannel(key).catch(() => {});
        }
      }),
    [relay.id, load, key]
  );

  const pick = (f?: File | null) => {
    if (!f) return;
    if (!/^(image|video)\//.test(f.type)) return toast('Only images and videos can be posted here.', 'error');
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (canPost) pick(e.dataTransfer.files?.[0]);
  };

  const canDelete = (item: GalleryItem) => canModerate || item.author.id === meId;
  const remove = (item: GalleryItem) =>
    confirmAction({
      title: 'Delete Post',
      body: 'Are you sure you want to delete this post? It will be removed for everyone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/transmissions/${item.transmissionId}`);
        setOpen(null);
        await load();
      },
    });

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!canPost || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        <ImageIcon className="h-6 w-6 text-fg-subtle" />
        <h1 className="font-semibold text-fg">{relay.name}</h1>
        {relay.topic && <span className="ml-2 min-w-0 flex-1 truncate text-sm text-fg-muted">{toPlainText(relay.topic)}</span>}
        <div className="ml-auto">
          {canPost && (
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="mr-1.5 h-4 w-4" /> Upload
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            aria-label="Choose media to upload"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {items === null ? (
          <p className="py-16 text-center text-sm text-fg-muted">Loading media…</p>
        ) : items.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <span className="mx-auto mb-4 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-overlay">
              <ImageIcon className="h-9 w-9 text-fg" />
            </span>
            <h2 className="text-2xl font-bold text-fg">Welcome to #{relay.name}!</h2>
            <p className="mt-2 text-fg-muted">{canPost ? 'Share the first image or video. Drop a file anywhere here, or use Upload.' : 'Nothing has been posted here yet.'}</p>
          </div>
        ) : (
          <ul aria-label={`Media in #${relay.name}`} className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {items.map((item, i) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  aria-label={item.caption || item.filename}
                  className="group relative block aspect-square w-full overflow-hidden rounded-lg bg-raised focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {item.video ? (
                    <>
                      <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />
                      <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white">
                        <Play className="h-5 w-5 translate-x-px" />
                      </span>
                    </>
                  ) : (
                    <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
                  )}
                  <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-2 pt-8 text-left opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Avatar user={item.author} size={20} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">{item.caption || item.author.displayName || item.author.username}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand bg-base/90">
          <p className="text-lg font-semibold text-fg">Drop to upload to #{relay.name}</p>
        </div>
      )}
      {file && <UploadDialog relay={relay} file={file} onClose={() => setFile(null)} onPosted={() => void load()} />}
      {open !== null && items && <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} canDelete={canDelete} onDelete={remove} />}
    </div>
  );
}
