import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { clsx } from 'clsx';
import { Lock, LockOpen, MessageSquare, MessagesSquare, Pin, PinOff, Plus, Search, X } from 'lucide-react';
import { Button, Input, Modal, Tooltip } from '@subspace/ui';
import { useStore, setState } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { gateway } from '../../services/gateway';
import { http } from '../../lib/http';
import { toUserRef } from '../../lib/normalize';
import { channelKey, type Relay, type UserRef } from '../../lib/types';
import { formatMessageTime } from '../../lib/time';
import { term } from '../../lib/strings';
import { toast, useUi } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { toPlainText } from '../chat/markdown';
import { MessageList } from '../chat/MessageList';
import { Composer } from '../chat/Composer';
import { TypingIndicator } from '../chat/TypingIndicator';
import { MobileNavButton } from '../../app/mobile';

export interface ForumThread {
  id: string;
  relayId: string;
  title: string;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  author: UserRef;
  replyCount: number;
  lastActivityAt: string;
  createdAt: string;
  preview: string;
  previewImage: string | null;
}

type Raw = Record<string, any>;

const toThread = (raw: Raw): ForumThread => {
  const t = raw.thread ?? raw;
  return {
    id: t.id,
    relayId: t.relayId,
    title: t.title,
    tags: t.tags ?? [],
    isPinned: !!t.isPinned,
    isLocked: !!t.isLocked,
    author: toUserRef(raw.author ?? { id: t.transmitterId }),
    replyCount: Math.max(0, (t.transmissionCount ?? 1) - 1),
    lastActivityAt: t.lastTransmissionAt ?? t.updatedAt ?? t.createdAt,
    createdAt: t.createdAt,
    preview: raw.preview ?? '',
    previewImage: raw.previewImage ?? null,
  };
};

const sortThreads = (list: ForumThread[], mode: 'activity' | 'created') =>
  [...list].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const ka = mode === 'activity' ? a.lastActivityAt : a.createdAt;
    const kb = mode === 'activity' ? b.lastActivityAt : b.createdAt;
    return ka < kb ? 1 : -1;
  });

function NewPostModal({ relay, tags, onClose, onCreated }: { relay: Relay; tags: string[]; onClose: () => void; onCreated: (t: ForumThread) => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const me = useStore((s) => s.me);

  const addCustom = () => {
    const tag = custom.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24);
    if (tag && !picked.includes(tag) && picked.length < 5) setPicked([...picked, tag]);
    setCustom('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    try {
      const res = await http.post<{ thread: Raw }>(`/relays/${relay.id}/archival/threads`, { title: title.trim(), content: content.trim(), tags: picked });
      onCreated(toThread({ thread: res.thread, author: me, preview: content.trim() }));
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`New post in #${relay.name}`} maxWidth="xl">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Opening transmission</p>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            maxLength={2000}
            aria-label="Opening transmission"
            placeholder="Markdown, quotes and code blocks are supported."
            className="w-full resize-y rounded-md border border-line bg-void px-3 py-2 text-sm text-fg outline-none focus:border-brand"
          />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">Tags (up to 5)</p>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...tags, ...picked])].map((t) => {
              const on = picked.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== t) : p.length < 5 ? [...p, t] : p))}
                  className={clsx('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-brand bg-brand-soft text-fg' : 'border-line-strong text-fg-muted hover:bg-hover')}
                >
                  {t}
                </button>
              );
            })}
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="+ new tag"
              aria-label="New tag"
              className="h-6 w-28 rounded-full border border-dashed border-line-strong bg-transparent px-2.5 text-xs text-fg outline-none"
            />
          </div>
        </div>
        <div className="-mx-6 -mb-4 flex justify-end gap-3 bg-raised px-6 py-4">
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!title.trim() || !content.trim()}>
            Post
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ThreadPane({ relay, thread, canManage, onChange, onClose }: { relay: Relay; thread: ForumThread; canManage: boolean; onChange: (t: ForumThread) => void; onClose: () => void }) {
  const key = channelKey('thread', thread.id);
  useEffect(() => {
    setState({ activeChannel: key });
    return () => setState({ activeChannel: null });
  }, [key]);

  const patch = async (updates: Partial<Pick<ForumThread, 'isLocked' | 'isPinned'>>) => {
    onChange({ ...thread, ...updates });
    try {
      await http.patch(`/relays/${relay.id}/archival/threads/${thread.id}`, updates);
    } catch (err) {
      onChange(thread);
      toast((err as Error).message, 'error');
    }
  };

  return (
    <section aria-label={thread.title} className="relative flex min-w-0 flex-1 flex-col border-l border-line bg-base">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <MessageSquare className="h-5 w-5 shrink-0 text-fg-subtle" />
        <h2 className="min-w-0 flex-1 truncate font-semibold text-fg">{thread.title}</h2>
        {canManage && (
          <>
            <Tooltip content={thread.isPinned ? 'Unpin post' : 'Pin post'} placement="bottom">
              <button type="button" aria-label={thread.isPinned ? 'Unpin post' : 'Pin post'} onClick={() => void patch({ isPinned: !thread.isPinned })} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
                {thread.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            </Tooltip>
            <Tooltip content={thread.isLocked ? 'Unlock post' : 'Lock post'} placement="bottom">
              <button type="button" aria-label={thread.isLocked ? 'Unlock post' : 'Lock post'} onClick={() => void patch({ isLocked: !thread.isLocked })} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
                {thread.isLocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </button>
            </Tooltip>
          </>
        )}
        <Tooltip content="Close" placement="bottom">
          <button type="button" aria-label="Close post" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </Tooltip>
      </header>
      <MessageList
        channelKey={key}
        beaconId={relay.beaconId}
        onReply={(messageId) => useUi.setState((u) => ({ replyingTo: { ...u.replyingTo, [key]: { messageId, ping: true } } }))}
        header={
          <div className="mx-4 mb-2 mt-8">
            <h2 className="text-2xl font-bold text-fg">{thread.title}</h2>
            {thread.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {thread.tags.map((t) => (
                  <span key={t} className="rounded-full bg-overlay px-2 py-0.5 text-xs text-fg-muted">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        }
      />
      <Composer
        channelKey={key}
        beaconId={relay.beaconId}
        placeholder={`Reply to ${thread.title}`}
        disabledReason={thread.isLocked && !canManage ? 'This post is locked. Only moderators can reply.' : null}
      />
      <TypingIndicator channelKey={key} beaconId={relay.beaconId} />
    </section>
  );
}

/** Archival Relay: Discord-style forum with post cards and a split-pane thread view. */
export function ForumView({ relay }: { relay: Relay }) {
  const navigate = useNavigate();
  const { threadId } = useParams();
  const meId = useStore((s) => s.me?.id);
  const perms = useStore((s) => relayPermissions(s, relay.id));
  const canPost = can(perms, PERMISSIONS.SEND_TRANSMISSIONS);
  const canModerate = can(perms, PERMISSIONS.MANAGE_TRANSMISSIONS);
  const [threads, setThreads] = useState<ForumThread[] | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<'activity' | 'created'>('activity');
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await http.get<{ threads: Raw[] }>(`/relays/${relay.id}/archival/threads`);
      setThreads(res.threads.map(toThread));
    } catch (err) {
      toast((err as Error).message, 'error');
      setThreads([]);
    }
  }, [relay.id]);

  useEffect(() => {
    setThreads(null);
    void load();
  }, [load]);

  // Live updates: new posts, lock/pin changes, reply activity.
  useEffect(
    () =>
      gateway.onDispatch((type, d) => {
        if ((type === 'THREAD_CREATE' || type === 'THREAD_UPDATE') && d?.relayId === relay.id && d.thread) {
          setThreads((list) => {
            if (!list) return list;
            const existing = list.find((t) => t.id === d.thread.id);
            const next = toThread({ thread: d.thread, author: existing?.author ?? { id: d.thread.transmitterId }, preview: existing?.preview, previewImage: existing?.previewImage });
            return existing ? list.map((t) => (t.id === next.id ? { ...existing, ...next, author: existing.author } : t)) : [next, ...list];
          });
          if (type === 'THREAD_CREATE' && d.thread.transmitterId !== meId) void load();
        }
        if (type === 'TRANSMISSION_CREATE' && d?.channelType === 'thread') {
          setThreads((list) => list?.map((t) => (t.id === d.channelId ? { ...t, replyCount: t.replyCount + 1, lastActivityAt: d.transmission?.createdAt ?? t.lastActivityAt } : t)) ?? list);
        }
      }),
    [relay.id, meId, load]
  );

  const allTags = useMemo(() => [...new Set((threads ?? []).flatMap((t) => t.tags))].sort(), [threads]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortThreads(
      (threads ?? []).filter((t) => (!tag || t.tags.includes(tag)) && (!q || t.title.toLowerCase().includes(q) || t.preview.toLowerCase().includes(q))),
      sort
    );
  }, [threads, query, tag, sort]);

  const selected = threads?.find((t) => t.id === threadId) ?? null;
  const open = (id: string | null) => navigate(id ? `/channels/${relay.beaconId}/${relay.id}/threads/${id}` : `/channels/${relay.beaconId}/${relay.id}`);

  return (
    <div className="flex min-h-0 flex-1">
      <div className={clsx('flex min-w-0 flex-col', selected ? 'hidden w-[46%] max-w-[560px] md:flex' : 'flex-1')}>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        <MobileNavButton />
          <MessagesSquare className="h-6 w-6 text-fg-subtle" />
          <h1 className="font-semibold text-fg">{relay.name}</h1>
          {relay.topic && !selected && <span className="ml-2 truncate text-sm text-fg-muted">{toPlainText(relay.topic)}</span>}
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-4">
          <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-md bg-void px-3">
            <Search className="h-4 w-4 text-fg-subtle" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search posts" aria-label="Search posts" className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
          </label>
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort posts" className="h-9 rounded-md border border-line bg-void px-2 text-sm text-fg">
            <option value="activity">Recent activity</option>
            <option value="created">Creation date</option>
          </select>
          <Button size="sm" className="h-9" disabled={!canPost} onClick={() => setComposing(true)}>
            <Plus className="h-4 w-4" /> New Post
          </Button>
        </div>
        {allTags.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pt-3">
            {[null, ...allTags].map((t) => (
              <button
                key={t ?? '__all'}
                type="button"
                aria-pressed={tag === t}
                onClick={() => setTag(t)}
                className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', tag === t ? 'bg-brand text-on-brand' : 'bg-overlay text-fg-muted hover:bg-hover hover:text-fg')}
              >
                {t ?? 'All'}
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {threads === null &&
            Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-raised" />)}
          {threads?.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-20 text-center text-fg-muted">
              <MessagesSquare className="h-10 w-10 text-fg-subtle" />
              <p className="font-semibold text-fg">No posts yet</p>
              <p className="text-sm">Start the first discussion in this {term('archival').toLowerCase()}.</p>
            </div>
          )}
          {threads && threads.length > 0 && shown.length === 0 && <p className="py-10 text-center text-sm text-fg-subtle">No posts match your filters.</p>}
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={t.id === threadId ? 'true' : undefined}
              onClick={() => open(t.id)}
              className={clsx('flex w-full gap-3 rounded-lg border p-4 text-left transition-colors', t.id === threadId ? 'border-brand bg-active' : 'border-line bg-raised hover:bg-hover')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {t.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-star" aria-label="Pinned" />}
                  {t.isLocked && <Lock className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-label="Locked" />}
                  <h3 className="truncate font-semibold text-fg">{t.title}</h3>
                </div>
                {t.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.tags.map((tg) => (
                      <span key={tg} className="rounded-full bg-overlay px-2 text-[11px] text-fg-muted">
                        {tg}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 line-clamp-2 text-sm text-fg-muted">
                  <span className="font-medium text-fg">
                    <UserName user={t.author} beaconId={relay.beaconId} styled={false} />:
                  </span>{' '}
                  {toPlainText(t.preview) || 'No preview available.'}
                </p>
                <p className="mt-2 flex items-center gap-3 text-xs text-fg-subtle">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3.5 w-3.5" /> {t.replyCount}
                  </span>
                  <span>{formatMessageTime(t.lastActivityAt)}</span>
                </p>
              </div>
              {t.previewImage ? (
                <img src={t.previewImage} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" />
              ) : (
                <Avatar user={t.author} size={32} />
              )}
            </button>
          ))}
        </div>
      </div>
      {selected ? (
        <ThreadPane
          key={selected.id}
          relay={relay}
          thread={selected}
          canManage={canModerate || selected.author.id === meId}
          onChange={(t) => setThreads((list) => list?.map((x) => (x.id === t.id ? t : x)) ?? list)}
          onClose={() => open(null)}
        />
      ) : null}
      {composing && (
        <NewPostModal
          relay={relay}
          tags={allTags}
          onClose={() => setComposing(false)}
          onCreated={(t) => {
            setThreads((list) => [t, ...(list ?? []).filter((x) => x.id !== t.id)]);
            open(t.id);
          }}
        />
      )}
    </div>
  );
}
