import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Bell, BellOff, Pin, Users, Search, Inbox, CircleHelp, Hash } from 'lucide-react';
import { ComingSoon, Tooltip, useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { setState, useStore } from '../../data/store';
import { loadPins } from '../../data/actions';
import { effectiveNotification, isMuted, settingFor } from '../../data/notifications';
import { muteDurations, setNotificationSetting } from '../../data/notificationActions';
import { parseChannelKey, type ChannelKey, type NotificationLevel, type Transmission } from '../../lib/types';
import { useUi, openModal } from '../../app/ui';
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
      className="fixed z-[1200] flex max-h-[70vh] w-[420px] flex-col overflow-hidden rounded-lg bg-overlay shadow-pop"
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
              <Markdown content={m.content} resolvers={resolvers} />
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

function NotificationButton({ channelKey: key }: { channelKey: ChannelKey }) {
  const { type, id } = parseChannelKey(key);
  const scope = type === 'relay' ? 'relay' : type === 'link' ? 'link' : 'mesh';
  const setting = useStore((s) => settingFor(s, scope, id));
  const muted = isMuted(setting);
  const eff = useStore((s) => effectiveNotification(s, key));
  const { openContextMenu } = useContextMenu();
  const menu = (): ContextMenuItem[] => [
    muted
      ? { label: 'Unmute', onClick: () => void setNotificationSetting(scope, id, { mutedUntil: null }) }
      : { label: 'Mute', children: muteDurations().map((d) => ({ label: d.label, onClick: () => void setNotificationSetting(scope, id, { mutedUntil: d.until() }) })) },
    { separator: true },
    ...(type === 'relay'
      ? LEVEL_LABELS.map<ContextMenuItem>((l) => ({
          label: l.label,
          sublabel: l.level === 'inherit' ? `Currently: ${eff.level === 'all' ? 'All' : eff.level === 'mentions' ? '@mentions' : 'Nothing'}` : undefined,
          checked: (setting?.level ?? 'inherit') === l.level,
          onClick: () => void setNotificationSetting(scope, id, { level: l.level }),
        }))
      : []),
  ];
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
}

export function ChannelView({ channelKey: key, beaconId, icon, title, topic, placeholder, welcome, actions, aside }: ChannelViewProps) {
  const memberListOpen = useUi((s) => s.memberListOpen);
  const [pinsAnchor, setPinsAnchor] = useState<DOMRect | null>(null);
  const resolvers = useMarkdownResolvers(beaconId);

  useEffect(() => {
    setState({ activeChannel: key });
    return () => setState({ activeChannel: null });
  }, [key]);

  const onReply = (messageId: string) => {
    const s = useStore.getState();
    const msg = s.messages[key]?.byId[messageId];
    useUi.setState((u) => ({ replyingTo: { ...u.replyingTo, [key]: { messageId, ping: msg?.author.id !== s.me?.id } } }));
  };

  const showAside = memberListOpen && (aside !== undefined || !!beaconId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        <span className="text-fg-subtle">{icon}</span>
        <h1 className="shrink-0 font-semibold text-fg">{title}</h1>
        {topic && (
          <>
            <span className="mx-2 h-6 w-px bg-line-strong" />
            <div className="min-w-0 flex-1 truncate text-sm text-fg-muted [&_div]:inline">
              <Markdown content={topic.split('\n')[0]} resolvers={resolvers} />
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <ComingSoon label="Threads" placement="bottom">
            <span className="flex h-8 w-8 items-center justify-center text-fg-muted">
              <Hash className="h-5 w-5" />
            </span>
          </ComingSoon>
          <NotificationButton channelKey={key} />
          <HeaderButton label="Pinned Transmissions" onClick={(e) => setPinsAnchor(e.currentTarget.getBoundingClientRect())}>
            <Pin className="h-5 w-5" />
          </HeaderButton>
          {(beaconId || aside !== undefined) && (
            <HeaderButton label={memberListOpen ? 'Hide Member List' : 'Show Member List'} active={memberListOpen} onClick={() => useUi.setState({ memberListOpen: !memberListOpen })}>
              <Users className="h-5 w-5" />
            </HeaderButton>
          )}
          <button
            type="button"
            onClick={() => openModal({ kind: 'quickScan' })}
            className="flex h-6 w-36 items-center justify-between rounded-sm bg-void px-1.5 text-xs text-fg-subtle"
          >
            Search <Search className="h-3.5 w-3.5" />
          </button>
          <ComingSoon label="Inbox" placement="bottom">
            <span className="flex h-8 w-8 items-center justify-center text-fg-muted">
              <Inbox className="h-5 w-5" />
            </span>
          </ComingSoon>
          <ComingSoon label="Help" placement="bottom">
            <span className="flex h-8 w-8 items-center justify-center text-fg-muted">
              <CircleHelp className="h-5 w-5" />
            </span>
          </ComingSoon>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <MessageList channelKey={key} beaconId={beaconId} header={welcome} onReply={onReply} />
          <Composer channelKey={key} beaconId={beaconId} placeholder={placeholder} />
          <TypingIndicator channelKey={key} beaconId={beaconId} />
        </section>
        {showAside && (aside ?? (beaconId ? <MemberList beaconId={beaconId} /> : null))}
      </div>

      {pinsAnchor && <PinsPopover channelKey={key} beaconId={beaconId} anchor={pinsAnchor} onClose={() => setPinsAnchor(null)} />}
    </div>
  );
}
