import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { AtSign, Bookmark, Check, CheckCheck, ChevronDown, Clock, Hash, Inbox, Lock, Trash2, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { Tooltip } from '@subspace/ui';
import { useStore, type SubspaceState } from '../../data/store';
import { ackChannel } from '../../data/actions';
import { channelIndicator } from '../../data/selectors';
import { http } from '../../lib/http';
import { toTransmission } from '../../lib/normalize';
import { channelKey, parseChannelKey, type ChannelKey, type Transmission } from '../../lib/types';
import { formatMessageTime } from '../../lib/time';
import { useUi } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown } from './markdown';
import { useMarkdownResolvers } from './resolvers';
import { setBookmarked, useInbox } from '../inbox/inboxData';

/** Where a transmission is, as the API describes it for Inbox items. */
interface Place {
  channelType: string;
  channelId: string;
  name?: string;
  beaconId?: string | null;
  beaconName?: string;
}
interface Item {
  transmission: Transmission;
  channel: Place;
}
interface ReminderItem extends Item {
  id: string;
  remindAt: string;
  due: boolean;
}

type Tab = 'unreads' | 'mentions' | 'bookmarks' | 'reminders';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'unreads', label: 'Unreads' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'reminders', label: 'Reminders' },
];
const UNREAD_PREVIEW = 3;

const placeLabel = (p: Place, s: SubspaceState) =>
  p.channelType === 'relay' ? `#${p.name ?? s.relays[p.channelId]?.name ?? 'relay'}` : p.channelType === 'mesh' ? s.meshes[p.channelId]?.name ?? 'Subspace Mesh' : s.links[p.channelId]?.recipient.displayName || 'Direct Link';

function MessageBody({ t, beaconId }: { t: Transmission; beaconId?: string | null }) {
  const resolvers = useMarkdownResolvers(beaconId ?? undefined);
  return (
    <div className="flex gap-3">
      <Avatar user={t.author} size={32} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <UserName user={t.author} beaconId={beaconId ?? undefined} className="font-medium" />{' '}
          <span className="text-xs text-fg-subtle">{formatMessageTime(t.createdAt)}</span>
        </p>
        <div className="line-clamp-4 text-sm text-fg [overflow-wrap:anywhere]">
          {t.encrypted ? <span className="text-fg-muted italic">Encrypted transmission</span> : <Markdown content={t.content} resolvers={resolvers} />}
        </div>
      </div>
    </div>
  );
}

/** A transmission with where it is, for the Mentions, Bookmarks and Reminders tabs. */
function ItemCard({ item, onJump, actions }: { item: Item; onJump: () => void; actions?: React.ReactNode }) {
  const s = useStore();
  const p = item.channel;
  return (
    <article aria-label={`${placeLabel(p, s)}: ${item.transmission.content.slice(0, 60)}`} className="rounded-lg border border-line bg-raised">
      <header className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs font-semibold text-fg-muted">
        {p.channelType === 'relay' ? <Hash className="h-3.5 w-3.5" /> : <AtSign className="h-3.5 w-3.5" />}
        <span className="min-w-0 flex-1 truncate">
          {placeLabel(p, s)}
          {p.beaconName ? <span className="font-normal text-fg-subtle"> · {p.beaconName}</span> : null}
        </span>
        {actions}
        <button type="button" onClick={onJump} className="rounded-md bg-overlay px-2 py-0.5 text-fg hover:bg-hover">
          Jump
        </button>
      </header>
      <div className="p-3">
        <MessageBody t={item.transmission} beaconId={p.beaconId} />
      </div>
    </article>
  );
}

/** One channel with something unread: its newest unread transmissions. */
function UnreadCard({ k, onOpen }: { k: ChannelKey; onOpen: () => void }) {
  const s = useStore();
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState<Transmission[] | null>(null);
  const { type, id } = parseChannelKey(k);
  const relay = type === 'relay' ? s.relays[id] : undefined;
  const beacon = relay ? s.beacons[relay.beaconId] : undefined;
  const encrypted = (type === 'link' && !!s.links[id]?.encryptedAt) || (type === 'mesh' && !!(s.meshes[id] as { encryptedAt?: string | null } | undefined)?.encryptedAt);
  const lastReadId = s.readStates[k]?.lastReadId ?? null;
  const ind = channelIndicator(s, k);
  useEffect(() => {
    if (encrypted) return setPreview([]);
    const q = lastReadId ? `?after=${lastReadId}&limit=${UNREAD_PREVIEW + 1}` : `?limit=${UNREAD_PREVIEW}`;
    void http
      .get<{ transmissions: any[] }>(`/channels/${type}/${id}/transmissions${q}`)
      .then((r) => setPreview(r.transmissions.map(toTransmission).filter((t) => t.id !== lastReadId).slice(-UNREAD_PREVIEW)))
      .catch(() => setPreview([]));
  }, [type, id, lastReadId, encrypted]);
  const name = relay ? relay.name : placeLabel({ channelType: type, channelId: id }, s);
  return (
    <section aria-label={`Unread in ${name}`} className="rounded-lg border border-line bg-raised">
      <header className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {relay ? <Hash className="h-4 w-4 shrink-0 text-fg-subtle" /> : type === 'mesh' ? <Users className="h-4 w-4 shrink-0 text-fg-subtle" /> : <AtSign className="h-4 w-4 shrink-0 text-fg-subtle" />}
          <span className="min-w-0">
            <span className="block truncate font-semibold text-fg">{name}</span>
            <span className="block truncate text-xs text-fg-subtle">
              {beacon?.name ?? (type === 'mesh' ? 'Subspace Mesh' : 'Direct Link')}
              {ind.mentions ? ` · ${ind.mentions} mention${ind.mentions === 1 ? '' : 's'}` : ''}
            </span>
          </span>
        </button>
        <Tooltip content="Mark as Read">
          <button type="button" aria-label={`Mark ${name} as read`} onClick={() => void ackChannel(k)} className="rounded-md p-1.5 text-fg-muted hover:bg-hover hover:text-fg">
            <Check className="h-4 w-4" />
          </button>
        </Tooltip>
        <button type="button" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-md p-1.5 text-fg-muted hover:bg-hover hover:text-fg">
          <ChevronDown className={clsx('h-4 w-4 transition-transform', !open && '-rotate-90')} />
        </button>
      </header>
      {open && (
        <div className="space-y-3 border-t border-line p-3">
          {encrypted ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Lock className="h-4 w-4" /> New encrypted transmissions: open the conversation to read them.
            </p>
          ) : preview === null ? (
            <p className="text-sm text-fg-subtle">Loading…</p>
          ) : (
            preview.map((t) => <MessageBody key={t.id} t={t} beaconId={relay?.beaconId} />)
          )}
        </div>
      )}
    </section>
  );
}

/** Discord's Inbox: what is unread, what mentions you, what you bookmarked, and your reminders. */
export function InboxPopover({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('unreads');
  const [mentions, setMentions] = useState<Item[] | null>(null);
  const [more, setMore] = useState(false);
  const [bookmarks, setBookmarks] = useState<Item[] | null>(null);
  const [reminders, setReminders] = useState<ReminderItem[] | null>(null);
  const dueReminders = useInbox((s) => s.dueReminders);
  const ref = useRef<HTMLDivElement>(null);
  const s = useStore();

  // Every conversation with something unread: relays, Direct Links and meshes.
  const unreadKeys = [
    ...Object.values(s.relays)
      .filter((r) => r.type === 'text')
      .map((r) => channelKey('relay', r.id)),
    ...Object.keys(s.links).map((id) => channelKey('link', id)),
    ...Object.keys(s.meshes).map((id) => channelKey('mesh', id)),
  ]
    .filter((k) => channelIndicator(s, k).unread)
    .sort((a, b) => (s.activity[b]?.lastAt ?? '').localeCompare(s.activity[a]?.lastAt ?? ''));

  const loadMentions = async (before?: string) => {
    const r = await http.get<{ mentions: Array<{ transmission: any; channel: Place }> }>(`/users/@me/mentions?limit=25${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    const page = r.mentions.map((m) => ({ ...m, transmission: toTransmission(m.transmission) }));
    setMentions((cur) => (before ? [...(cur ?? []), ...page] : page));
    setMore(page.length === 25);
  };
  useEffect(() => {
    if (tab === 'mentions' && mentions === null) void loadMentions().catch(() => setMentions([]));
    if (tab === 'bookmarks')
      void http
        .get<{ bookmarks: Array<{ transmission: any; channel: Place }> }>('/users/@me/bookmarks')
        .then((r) => setBookmarks(r.bookmarks.map((b) => ({ ...b, transmission: toTransmission(b.transmission) }))), () => setBookmarks([]));
    if (tab === 'reminders')
      void http.get<{ reminders: Array<ReminderItem & { transmission: any }> }>('/users/@me/reminders').then(
        (r) => {
          const list = r.reminders.map((x) => ({ ...x, transmission: toTransmission(x.transmission) }));
          setReminders(list);
          useInbox.setState({ dueReminders: list.filter((x) => x.due).length });
        },
        () => setReminders([])
      );
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !(e.target as Element)?.closest?.('[role="menu"],[role="dialog"]:not([aria-label="Inbox"])') && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const go = (p: Place, messageId?: string) => {
    onClose();
    const key = channelKey(p.channelType as any, p.channelId);
    if (messageId) useUi.setState({ jumpTarget: { key, messageId } });
    const beaconId = p.beaconId ?? (p.channelType === 'relay' ? s.relays[p.channelId]?.beaconId : undefined);
    if (p.channelType === 'relay' && beaconId) navigate(`/channels/${beaconId}/${p.channelId}`);
    else navigate(`/channels/@me/${p.channelId}`);
  };

  const finish = async (r: ReminderItem) => {
    await http.patch(`/users/@me/reminders/${r.id}`, { done: true }).catch(() => {});
    setReminders((list) => list?.filter((x) => x.id !== r.id) ?? null);
    if (r.due) useInbox.setState((st) => ({ dueReminders: Math.max(0, st.dueReminders - 1) }));
  };

  const empty = (text: string) => <p className="py-10 text-center text-sm text-fg-muted">{text}</p>;
  const loading = <p className="py-6 text-center text-sm text-fg-subtle">Loading…</p>;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Inbox"
      className="fixed z-[1200] flex max-h-[80vh] w-[min(520px,calc(100vw-16px))] flex-col overflow-hidden rounded-lg bg-overlay shadow-pop"
      style={{ top: anchor.bottom + 8, left: Math.max(8, Math.min(anchor.right - 520, window.innerWidth - 528)) }}
    >
      <header className="border-b border-line px-4 pt-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flex flex-1 items-center gap-2 font-semibold">
            <Inbox className="h-5 w-5" /> Inbox
          </h2>
          {tab === 'unreads' && unreadKeys.length > 0 && (
            <Tooltip content="Mark All as Read">
              <button type="button" aria-label="Mark all as read" onClick={() => unreadKeys.forEach((k) => void ackChannel(k))} className="rounded-md p-1.5 text-fg-muted hover:bg-hover hover:text-fg">
                <CheckCheck className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
        <div role="tablist" className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx('flex-1 border-b-2 pb-2 text-sm font-medium', tab === t.id ? 'border-brand text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
            >
              {t.label}
              {t.id === 'reminders' && dueReminders > 0 && <span className="ml-1.5 rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{dueReminders}</span>}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {tab === 'unreads' && (unreadKeys.length === 0 ? empty('You’re all caught up.') : unreadKeys.slice(0, 30).map((k) => <UnreadCard key={k} k={k} onOpen={() => go({ channelType: parseChannelKey(k).type, channelId: parseChannelKey(k).id })} />))}

        {tab === 'mentions' && (
          <>
            {mentions === null && loading}
            {mentions?.length === 0 && empty('Nobody has mentioned you lately.')}
            {mentions?.map((m) => <ItemCard key={m.transmission.id} item={m} onJump={() => go(m.channel, m.transmission.id)} />)}
            {more && mentions && (
              <button type="button" className="w-full py-2 text-sm text-brand-sky hover:underline" onClick={() => void loadMentions(mentions.at(-1)!.transmission.createdAt)}>
                Load more
              </button>
            )}
          </>
        )}

        {tab === 'bookmarks' &&
          (bookmarks === null
            ? loading
            : bookmarks.length === 0
              ? empty('Right-click a transmission and choose Bookmark to keep it here.')
              : bookmarks.map((b) => (
                  <ItemCard
                    key={b.transmission.id}
                    item={b}
                    onJump={() => go(b.channel, b.transmission.id)}
                    actions={
                      <button
                        type="button"
                        aria-label="Remove bookmark"
                        onClick={() => void setBookmarked(b.transmission.id, false).then(() => setBookmarks((l) => l?.filter((x) => x.transmission.id !== b.transmission.id) ?? null))}
                        className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-danger"
                      >
                        <Bookmark className="h-3.5 w-3.5 fill-current" />
                      </button>
                    }
                  />
                )))}

        {tab === 'reminders' &&
          (reminders === null
            ? loading
            : reminders.length === 0
              ? empty('Right-click a transmission and choose Remind Me to come back to it.')
              : reminders.map((r) => (
                  <div key={r.id}>
                    <p className={clsx('mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold', r.due ? 'text-danger' : 'text-fg-muted')}>
                      <Clock className="h-3.5 w-3.5" />
                      {r.due ? 'Due ' : ''}
                      {new Date(r.remindAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                    <ItemCard
                      item={r}
                      onJump={() => go(r.channel, r.transmission.id)}
                      actions={
                        <>
                          <Tooltip content="Done">
                            <button type="button" aria-label="Mark reminder done" onClick={() => void finish(r)} className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-online">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Delete">
                            <button
                              type="button"
                              aria-label="Delete reminder"
                              onClick={() => void http.delete(`/users/@me/reminders/${r.id}`).then(() => setReminders((l) => l?.filter((x) => x.id !== r.id) ?? null))}
                              className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        </>
                      }
                    />
                  </div>
                )))}
      </div>
    </div>,
    document.body
  );
}
