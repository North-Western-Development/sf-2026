import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScheduledFeed } from '../schedule/ScheduleUI';
import { release, useInbox } from '../inbox/inboxData';
import { clsx } from 'clsx';
import { useStore } from '../../data/store';
import { ackChannel, loadMessages, loadUntil } from '../../data/actions';
import { toast, useUi } from '../../app/ui';
import type { ChannelKey, Transmission } from '../../lib/types';
import { formatDayDivider, GROUP_WINDOW_MS, isSameDay } from '../../lib/time';
import { MessageItem } from './MessageItem';

function shouldGroup(prev: Transmission | undefined, cur: Transmission): boolean {
  if (!prev || prev.type !== 'default' && prev.type !== 'reply') return false;
  if (cur.type !== 'default' || cur.replyTo) return false;
  if (prev.author.id !== cur.author.id) return false;
  if (!isSameDay(prev.createdAt, cur.createdAt)) return false;
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
}

function HistorySkeleton({ fill }: { fill?: boolean }) {
  return (
    <div className={clsx('flex flex-col justify-end space-y-5 px-4 py-4', fill && 'min-h-full')} aria-busy="true" aria-label="Loading transmissions">
      {Array.from({ length: fill ? 8 : 4 }, (_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-hover" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-hover" />
            <div className="h-3 animate-pulse rounded bg-hover" style={{ width: `${40 + (i % 4) * 12}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageList({
  channelKey: key,
  beaconId,
  header,
  onReply,
}: {
  channelKey: ChannelKey;
  beaconId?: string;
  /** Rendered above the first message once the start of history is reached. */
  header: React.ReactNode;
  onReply: (id: string) => void;
}) {
  const channel = useStore((s) => s.messages[key]);
  const meId = useStore((s) => s.me?.id);
  const scroller = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);

  // Snapshot the read marker when the channel opens so the NEW divider stays put while reading.
  const [unreadMarker, setUnreadMarker] = useState<{ lastReadAt: string | null; mentions: number } | null>(null);
  useEffect(() => {
    const s = useStore.getState();
    const rs = s.readStates[key];
    const act = s.activity[key];
    const hasUnread = !!act?.lastAt && (!rs?.lastReadAt || act.lastAt > rs.lastReadAt) && act.lastId !== rs?.lastReadId;
    setUnreadMarker(hasUnread ? { lastReadAt: rs?.lastReadAt ?? null, mentions: rs?.mentionCount ?? 0 } : null);
    atBottom.current = true;
    if (!s.messages[key]?.loaded) void loadMessages(key);
  }, [key]);

  const messages = useMemo(() => (channel ? channel.ids.map((id) => channel.byId[id]).filter(Boolean) : []), [channel]);

  // Keep pinned to the bottom on new content; preserve position when older pages prepend.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Own messages always scroll into view.
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    const last = messages.at(-1);
    if (last?.author.id === meId && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
      atBottom.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  const loadOlder = useCallback(() => {
    const ch = useStore.getState().messages[key];
    const first = ch?.ids.find((id) => !ch.byId[id]?.pending);
    if (!ch?.loaded || ch.loading || !ch.hasMoreBefore || !first) return;
    prevHeight.current = scroller.current?.scrollHeight ?? null;
    void loadMessages(key, { before: first });
  }, [key]);

  useEffect(() => {
    const el = topSentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadOlder(), { root: scroller.current, rootMargin: '600px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadOlder, key]);

  const onScroll = () => {
    const el = scroller.current!;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < 40;
    setShowJump(distance > el.clientHeight * 1.5);
    if (atBottom.current && document.hasFocus()) void ackChannel(key, { auto: true });
  };

  // Mark read when opened at the bottom.
  useEffect(() => {
    if (channel?.loaded && atBottom.current) void ackChannel(key, { auto: true });
  }, [channel?.loaded, key]);

  // Marked unread by hand: show where the unread part starts now.
  const heldAt = useInbox((s) => s.held[key]);
  useEffect(() => {
    if (!heldAt) return;
    const rs = useStore.getState().readStates[key];
    setUnreadMarker({ lastReadAt: rs?.lastReadAt ?? null, mentions: rs?.mentionCount ?? 0 });
  }, [heldAt, key]);
  // Leaving a channel ends its hold.
  useEffect(() => () => release(key), [key]);

  const jumpTo = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('bg-brand-soft');
    setTimeout(() => el.classList.remove('bg-brand-soft'), 1600);
  };

  // Jump requested from search results: page back until the message is loaded, then scroll to it.
  const jumpTarget = useUi((s) => (s.jumpTarget?.key === key ? s.jumpTarget.messageId : null));
  useEffect(() => {
    if (!jumpTarget) return;
    let cancelled = false;
    atBottom.current = false;
    void loadUntil(key, jumpTarget).then((found) => {
      if (cancelled) return;
      useUi.setState({ jumpTarget: null });
      if (!found) return toast('That transmission is no longer available.', 'error');
      requestAnimationFrame(() => jumpTo(jumpTarget));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, key]);

  const firstUnreadIndex = unreadMarker
    ? messages.findIndex((m) => m.author.id !== meId && (!unreadMarker.lastReadAt || m.createdAt > unreadMarker.lastReadAt))
    : -1;

  return (
    <div className="relative min-h-0 flex-1">
      {unreadMarker && firstUnreadIndex >= 0 && (
        <div className="absolute inset-x-4 top-0 z-10 flex h-7 items-center justify-between rounded-b-md bg-brand px-3 text-xs font-semibold text-on-brand shadow-pop">
          <button type="button" onClick={() => jumpTo(messages[firstUnreadIndex].id)} className="hover:underline">
            {messages.length - firstUnreadIndex} new transmission{messages.length - firstUnreadIndex === 1 ? '' : 's'}
            {unreadMarker.mentions ? ` (${unreadMarker.mentions} mention${unreadMarker.mentions === 1 ? '' : 's'})` : ''}
          </button>
          <button
            type="button"
            className="hover:underline"
            onClick={() => {
              setUnreadMarker(null);
              void ackChannel(key);
            }}
          >
            Mark as Read
          </button>
        </div>
      )}

      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto overflow-x-hidden pb-6" role="log" aria-live="polite" aria-relevant="additions">
        <div ref={topSentinel} className="h-px" />
        {/* Like Discord, placeholders stand above the history while there is more to load, so the
            list never shifts when they go; before the first page arrives they are all that shows. */}
        {channel?.loaded ? (channel.hasMoreBefore ? <HistorySkeleton /> : header) : !channel?.error && <HistorySkeleton fill />}
        {channel?.error && !channel.loaded && (
          <p className="px-4 py-6 text-sm text-danger">
            Could not load transmissions: {channel.error}{' '}
            <button className="text-brand-sky hover:underline" onClick={() => void loadMessages(key)}>
              Retry
            </button>
          </p>
        )}
        {channel?.loaded && messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt);
          const isFirstUnread = i === firstUnreadIndex;
          return (
            <div key={m.id}>
              {(newDay || isFirstUnread) && (
                <div role="separator" className="relative mx-4 mt-6 mb-2 flex items-center">
                  <span className={clsx('h-px flex-1', isFirstUnread ? 'bg-danger' : 'bg-line')} />
                  {newDay && <span className="px-2 text-xs font-semibold text-fg-subtle">{formatDayDivider(m.createdAt)}</span>}
                  {newDay && <span className={clsx('h-px flex-1', isFirstUnread ? 'bg-danger' : 'bg-line')} />}
                  {isFirstUnread && <span className="absolute right-0 rounded-sm bg-danger px-1 text-[10px] font-bold uppercase text-white">New</span>}
                </div>
              )}
              <MessageItem
                message={m}
                channelKey={key}
                beaconId={beaconId}
                grouped={!newDay && !isFirstUnread && shouldGroup(prev, m)}
                onReply={onReply}
                onJumpTo={jumpTo}
              />
            </div>
          );
        })}
        {/* What this device will send here later, or could not send: greyed out, at the end. */}
        {channel?.loaded && <ScheduledFeed channelKey={key} />}
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => {
            const el = scroller.current!;
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-overlay px-4 py-1.5 text-sm font-semibold text-fg shadow-pop hover:bg-hover"
        >
          Jump to present
        </button>
      )}
    </div>
  );
}
