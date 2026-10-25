import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { Lock, MessagesSquare, X } from 'lucide-react';
import { Tooltip } from '@subspace/ui';
import { useStore, setState } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { toast, useUi } from '../../app/ui';
import { channelKey, type Relay } from '../../lib/types';
import { formatMessageTime } from '../../lib/time';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { loadThreads, useThreads } from './threads';
import { http } from '../../lib/http';
import { startThread, threadPath } from './ThreadParts';

/** The header's Threads button: this relay's threads, newest activity first. */
export function ThreadsPopover({ relay, anchor, onClose }: { relay: Relay; anchor: DOMRect; onClose: () => void }) {
  const navigate = useNavigate();
  const threads = useThreads((s) => s.byRelay[relay.id]);
  const canCreate = useStore((s) => can(relayPermissions(s, relay.id), PERMISSIONS.CREATE_THREADS));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void loadThreads(relay.id).catch(() => undefined);
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc);
    };
  }, [relay.id, onClose]);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Threads"
      className="fixed z-[1200] flex max-h-[70vh] w-[420px] flex-col overflow-hidden rounded-lg bg-overlay shadow-pop"
      style={{ top: anchor.bottom + 8, left: Math.max(8, anchor.right - 420) }}
    >
      <header className="flex h-12 items-center gap-2 border-b border-line px-4">
        <MessagesSquare className="h-5 w-5 text-fg-muted" />
        <h2 className="flex-1 font-semibold">Threads</h2>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              onClose();
              startThread(relay, navigate);
            }}
            className="rounded-md bg-brand px-3 py-1 text-sm font-semibold text-on-brand hover:brightness-110"
          >
            Create
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!threads && <p className="py-6 text-center text-sm text-fg-subtle">Loading…</p>}
        {threads?.length === 0 && <p className="py-10 text-center text-sm text-fg-muted">There are no threads yet. Start one from a transmission&apos;s menu.</p>}
        {threads?.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              onClose();
              navigate(threadPath(relay.beaconId, relay.id, t.id));
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-hover"
          >
            <MessagesSquare className="h-4 w-4 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-fg">{t.title}</span>
              <span className="block text-xs text-fg-subtle">
                {t.messageCount} {t.messageCount === 1 ? 'message' : 'messages'} · {formatMessageTime(t.lastTransmissionAt)}
              </span>
            </span>
            {t.isLocked && <Lock className="h-4 w-4 text-fg-subtle" />}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

/** A text-relay thread, open beside the relay (where the member list was). */
export function TextThreadPane({ relay, threadId }: { relay: Relay; threadId: string }) {
  const navigate = useNavigate();
  const thread = useThreads((s) => s.byId[threadId]);
  const canManage = useStore((s) => can(relayPermissions(s, relay.id), PERMISSIONS.MANAGE_TRANSMISSIONS));
  const key = channelKey('thread', threadId);
  useEffect(() => {
    if (!thread) void loadThreads(relay.id).catch(() => toast('Could not load the thread', 'error'));
  }, [thread, relay.id]);
  useEffect(() => {
    setState({ activeChannel: key });
    return () => setState({ activeChannel: channelKey('relay', relay.id) });
  }, [key, relay.id]);

  const lock = async () => {
    if (!thread) return;
    await http.patch(`/relays/${relay.id}/threads/${thread.id}`, { isLocked: !thread.isLocked }).catch((e) => toast((e as Error).message, 'error'));
  };

  return (
    <section aria-label={thread ? `Thread ${thread.title}` : 'Thread'} className="relative flex w-[420px] min-w-0 shrink-0 flex-col border-l border-line bg-base">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <MessagesSquare className="h-5 w-5 shrink-0 text-fg-subtle" />
        <h2 className="min-w-0 flex-1 truncate font-semibold text-fg">{thread?.title ?? 'Thread'}</h2>
        {canManage && thread && (
          <Tooltip content={thread.isLocked ? 'Unlock Thread' : 'Lock Thread'} placement="bottom">
            <button type="button" aria-label={thread.isLocked ? 'Unlock Thread' : 'Lock Thread'} onClick={() => void lock()} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
              <Lock className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Close" placement="bottom">
          <button type="button" aria-label="Close thread" onClick={() => navigate(`/channels/${relay.beaconId}/${relay.id}`)} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
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
            <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-overlay">
              <MessagesSquare className="h-6 w-6 text-fg" />
            </span>
            <h2 className="text-2xl font-bold text-fg">{thread?.title}</h2>
            <p className="text-sm text-fg-muted">The start of this thread in #{relay.name}.</p>
          </div>
        }
      />
      <Composer
        channelKey={key}
        beaconId={relay.beaconId}
        placeholder={`Message ${thread?.title ?? 'thread'}`}
        disabledReason={thread?.isLocked && !canManage ? 'This thread is locked. Only moderators can send transmissions.' : null}
      />
      <TypingIndicator channelKey={key} beaconId={relay.beaconId} />
    </section>
  );
}
