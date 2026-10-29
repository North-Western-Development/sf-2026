import { useCallback, useEffect, useRef, useState } from 'react';
import { useInbox } from '../inbox/inboxData';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Bell, BellOff, Pin, Users, Inbox, CircleHelp, MessagesSquare, Megaphone, EllipsisVertical } from 'lucide-react';
import { Tooltip, useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { setState, useStore } from '../../data/store';
import { loadPins } from '../../data/actions';
import { effectiveNotification, isMuted, settingFor } from '../../data/notifications';
import { muteDurations, setNotificationSetting } from '../../data/notificationActions';
import { parseChannelKey, type ChannelKey, type NotificationLevel, type Transmission } from '../../lib/types';
import { openModal, useUi } from '../../app/ui';
import { ThreadsPopover } from './ThreadsUI';
import { InboxPopover } from './InboxPopover';
import { SearchBar, SearchResults } from '../search/Search';
import { MobileNavButton, MobileSheet, useIsMobile } from '../../app/mobile';
import { formatMessageTime } from '../../lib/time';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { MemberList } from '../members/MemberList';
import { Markdown } from './markdown';
import { useMarkdownResolvers } from './resolvers';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';

function PinsPopover({ channelKey: key, beaconId, anchor, onClose }: { channelKey: ChannelKey; beaconId?: string; anchor: DOMRect; onClose: () => void }) {
  const [pins, setPins] = useState<Transmission[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const resolvers = useMarkdownResolvers(beaconId);
  useEffect(() => {
    void loadPins(key).then(setPins).catch(() => setPins([]));
  }, [key]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Pinned transmissions"
      data-context-menu
      className="fixed z-[1200] flex max-h-[70vh] w-[min(420px,calc(100vw-16px))] flex-col overflow-hidden rounded-lg bg-overlay shadow-pop"
      style={{ top: anchor.bottom + 8, left: Math.max(8, anchor.right - 420) }}
    >
      <h2 className="flex h-12 items-center border-b border-line px-4 font-semibold">Pinned Transmissions</h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!pins && <p className="py-6 text-center text-sm text-fg-subtle">Loading…</p>}
        {pins?.length === 0 && (
          <div className="py-10 text-center">
            <Pin className="mx-auto mb-2 h-8 w-8 text-fg-subtle" />
            <p className="text-sm text-fg-muted">This relay doesn't have any pinned transmissions… yet.</p>
          </div>
        )}
        {pins?.map((m) => (
          <article key={m.id} className="mb-2 rounded-md border border-line bg-raised p-3">
            <div className="mb-1 flex items-center gap-2">
              <Avatar user={m.author} size={24} />
              <UserName user={m.author} beaconId={beaconId} className="text-sm font-medium" />
              <span className="text-xs text-fg-subtle">{formatMessageTime(m.createdAt)}</span>
            </div>
            <div className="text-sm text-fg">
              <Markdown content={useStore.getState().messages[key]?.byId[m.id]?.content || m.content} resolvers={resolvers} />
            </div>
          </article>
        ))}
      </div>
    </div>,
    document.body
  );
}

const LEVEL_LABELS: Array<{ level: NotificationLevel; label: string }> = [
  { level: 'inherit', label: 'Use Default' },
  { level: 'all', label: 'All Transmissions' },
  { level: 'mentions', label: 'Only @mentions' },
  { level: 'nothing', label: 'Nothing' },
];

/** Mute and notification level for one conversation: the header bell's menu (and the phone's More menu). */
function useNotificationMenu(key: ChannelKey) {
  const { type, id } = parseChannelKey(key);
  const scope = type === 'relay' ? 'relay' : type === 'link' ? 'link' : 'mesh';
  const setting = useStore((s) => settingFor(s, scope, id));
  const muted = isMuted(setting);
  const effLevel = useStore((s) => effectiveNotification(s, key).level);
  const menu = (): ContextMenuItem[] => [
    muted
      ? { label: 'Unmute', onClick: () => void setNotificationSetting(scope, id, { mutedUntil: null }) }
      : { label: 'Mute', children: muteDurations().map((d) => ({ label: d.label, onClick: () => void setNotificationSetting(scope, id, { mutedUntil: d.until() }) })) },
    { separator: true },
    ...(type === 'relay'
      ? LEVEL_LABELS.map<ContextMenuItem>((l) => ({
          label: l.label,
          sublabel: l.level === 'inherit' ? `Currently: ${effLevel === 'all' ? 'All' : effLevel === 'mentions' ? '@mentions' : 'Nothing'}` : undefined,
          checked: (setting?.level ?? 'inherit') === l.level,
          onClick: () => void setNotificationSetting(scope, id, { level: l.level }),
        }))
      : []),
  ];
  return { muted, menu };
}

function NotificationButton({ channelKey: key }: { channelKey: ChannelKey }) {
  const { muted, menu } = useNotificationMenu(key);
  const { openContextMenu } = useContextMenu();
  return (
    <HeaderButton label="Notification Settings" active={muted} onClick={(e) => openContextMenu({ clientX: e.currentTarget.getBoundingClientRect().left, clientY: e.currentTarget.getBoundingClientRect().bottom + 6 }, menu())}>
      {muted ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
    </HeaderButton>
  );
}

export function HeaderButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label} placement="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={clsx('flex h-8 w-8 items-center justify-center rounded-md', active ? 'text-fg' : 'text-fg-muted hover:text-fg')}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export interface ChannelViewProps {
  channelKey: ChannelKey;
  beaconId?: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  topic?: string | null;
  placeholder: string;
  welcome: React.ReactNode;
  /** Extra header controls (e.g. call buttons in DMs). */
  actions?: React.ReactNode;
  /** Right-hand panel override (DM profile panel); defaults to the beacon member list. */
  aside?: React.ReactNode;
  /** Full-width area under the header (the DM call view). */
  banner?: React.ReactNode;
  /** Shown beside the conversation whatever the member-list toggle says (an open thread). */
  sidePanel?: React.ReactNode;
}

export function ChannelView({ channelKey: key, beaconId, icon, title, topic, placeholder, welcome, actions, aside, banner, sidePanel }: ChannelViewProps) {
  const memberListOpen = useUi((s) => s.memberListOpen);
  const [pinsAnchor, setPinsAnchor] = useState<DOMRect | null>(null);
  const [threadsAnchor, setThreadsAnchor] = useState<DOMRect | null>(null);
  const [inboxAnchor, setInboxAnchor] = useState<DOMRect | null>(null);
  const closeThreads = useCallback(() => setThreadsAnchor(null), []);
  const closeInbox = useCallback(() => setInboxAnchor(null), []);
  const resolvers = useMarkdownResolvers(beaconId);
  const dueReminders = useInbox((s) => s.dueReminders);
  const threadsRelay = useStore((s) => {
    const { type, id } = parseChannelKey(key);
    return type === 'relay' && s.relays[id]?.type === 'text' ? s.relays[id] : undefined;
  });

  useEffect(() => {
    setState({ activeChannel: key });
    return () => setState({ activeChannel: null });
  }, [key]);

  const onReply = (messageId: string) => {
    const s = useStore.getState();
    const msg = s.messages[key]?.byId[messageId];
    useUi.setState((u) => ({ replyingTo: { ...u.replyingTo, [key]: { messageId, ping: msg?.author.id !== s.me?.id } } }));
  };

  const searchScope = beaconId ?? 'dms';
  const search = useUi((s) => (s.search?.scope === searchScope ? s.search : null));
  const mobile = useIsMobile();
  // Small screens start without the side panel; it opens over the conversation.
  const [mobileAside, setMobileAside] = useState(false);
  const hasAside = aside !== undefined || !!beaconId;
  const showAside = hasAside && (mobile ? mobileAside : memberListOpen);
  const asideOpen = mobile ? mobileAside : memberListOpen;
  const toggleAside = () => (mobile ? setMobileAside((v) => !v) : useUi.setState({ memberListOpen: !memberListOpen }));
  // An open thread takes the member list's place, as on Discord.
  // A phone has no room for the header's row of buttons: they live in one More menu.
  const notifications = useNotificationMenu(key);
  const { openContextMenu } = useContextMenu();
  const openMore = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const items: ContextMenuItem[] = [
      ...(threadsRelay?.isAnnouncement ? [{ label: 'Follow', icon: <Megaphone className="h-4 w-4" />, onClick: () => openModal({ kind: 'followRelay', relayId: threadsRelay.id }) }] : []),
      ...(threadsRelay ? [{ label: 'Threads', icon: <MessagesSquare className="h-4 w-4" />, onClick: () => setThreadsAnchor(rect) }] : []),
      { label: 'Pinned Transmissions', icon: <Pin className="h-4 w-4" />, onClick: () => setPinsAnchor(rect) },
      { label: 'Notification Settings', icon: notifications.muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />, children: notifications.menu() },
      { label: dueReminders ? `Inbox (${dueReminders} due)` : 'Inbox', icon: <Inbox className="h-4 w-4" />, onClick: () => setInboxAnchor(rect) },
      { separator: true },
      { label: 'Help', icon: <CircleHelp className="h-4 w-4" />, onClick: () => openModal({ kind: 'help' }) },
    ];
    openContextMenu({ clientX: rect.right, clientY: rect.bottom + 6 }, items);
  };
  const panel = search ?<SearchResults search={search} /> : sidePanel ?? (showAside ? (aside ?? (beaconId ? <MemberList beaconId={beaconId} /> : null)) : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        <MobileNavButton />
        <span className="text-fg-subtle">{icon}</span>
        <h1 className="min-w-0 shrink truncate font-semibold text-fg md:shrink-0">{title}</h1>
        {topic && !mobile && (
          <>
            <span className="mx-2 h-6 w-px bg-line-strong" />
            <div className="min-w-0 flex-1 truncate text-sm text-fg-muted [&_div]:inline">
              <Markdown content={topic.split('\n')[0]} resolvers={resolvers} />
            </div>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
          {actions}
          {!mobile && (
            <>
              {threadsRelay?.isAnnouncement && (
                <HeaderButton label="Follow" onClick={() => openModal({ kind: 'followRelay', relayId: threadsRelay.id })}>
                  <Megaphone className="h-5 w-5" />
                </HeaderButton>
              )}
              {threadsRelay && (
                <HeaderButton label="Threads" onClick={(e) => setThreadsAnchor(e.currentTarget.getBoundingClientRect())}>
                  <MessagesSquare className="h-5 w-5" />
                </HeaderButton>
              )}
              <NotificationButton channelKey={key} />
              <HeaderButton label="Pinned Transmissions" onClick={(e) => setPinsAnchor(e.currentTarget.getBoundingClientRect())}>
                <Pin className="h-5 w-5" />
              </HeaderButton>
            </>
          )}
          {hasAside && (
            <HeaderButton label={asideOpen ? 'Hide Member List' : 'Show Member List'} active={asideOpen} onClick={toggleAside}>
              <Users className="h-5 w-5" />
            </HeaderButton>
          )}
          <SearchBar scope={searchScope} />
          {mobile && (
            <HeaderButton label="More" onClick={openMore}>
              <EllipsisVertical className="h-5 w-5" />
            </HeaderButton>
          )}
          {!mobile && (
            <>
              <HeaderButton label={dueReminders ? `Inbox (${dueReminders} reminder${dueReminders === 1 ? '' : 's'} due)` : 'Inbox'} onClick={(e) => setInboxAnchor(e.currentTarget.getBoundingClientRect())}>
                <span className="relative">
                  <Inbox className="h-5 w-5" />
                  {dueReminders > 0 && <span aria-hidden className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-base" />}
                </span>
              </HeaderButton>
              <HeaderButton label="Help" onClick={() => openModal({ kind: 'help' })}>
                <CircleHelp className="h-5 w-5" />
              </HeaderButton>
            </>
          )}
        </div>
      </header>
      {banner}

      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <MessageList channelKey={key} beaconId={beaconId} header={welcome} onReply={onReply} />
          <Composer channelKey={key} beaconId={beaconId} placeholder={placeholder} />
          <TypingIndicator channelKey={key} beaconId={beaconId} />
        </section>
        {panel && !mobile && panel}
        {panel && mobile && (
          <MobileSheet onClose={() => (search ? useUi.setState({ search: null }) : setMobileAside(false))}>{panel}</MobileSheet>
        )}
      </div>

      {pinsAnchor && <PinsPopover channelKey={key} beaconId={beaconId} anchor={pinsAnchor} onClose={() => setPinsAnchor(null)} />}
      {threadsAnchor && threadsRelay && <ThreadsPopover relay={threadsRelay} anchor={threadsAnchor} onClose={closeThreads} />}
      {inboxAnchor && <InboxPopover anchor={inboxAnchor} onClose={closeInbox} />}
    </div>
  );
}
