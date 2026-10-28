import { useNavigate } from 'react-router';
import { ChevronRight, MessagesSquare } from 'lucide-react';
import { promptText } from '../../app/ui';
import type { Relay, Transmission } from '../../lib/types';
import { formatMessageTime } from '../../lib/time';
import { UserName } from '../common/UserName';
import { createThread, useThreads } from './threads';

export const threadPath = (beaconId: string, relayId: string, threadId: string) => `/channels/${beaconId}/${relayId}/threads/${threadId}`;

/** Asks for a name and starts a thread (from a transmission, or on its own), then opens it. */
export function startThread(relay: Relay, navigate: (path: string) => void, starter?: Transmission, isPrivate = false) {
  promptText({
    title: isPrivate ? 'Create Private Thread' : 'Create Thread',
    label: 'Thread Name',
    initial: starter ? (starter.content.replace(/\s+/g, ' ').trim().slice(0, 40) || 'New Thread') : 'New Thread',
    maxLength: 100,
    confirmLabel: 'Create Thread',
    onSubmit: async (name) => {
      const t = await createThread(relay.id, name || 'New Thread', starter?.id, isPrivate);
      navigate(threadPath(relay.beaconId, relay.id, t.id));
    },
  });
}

/** The box under a transmission that started a thread. */
export function ThreadChip({ m, beaconId }: { m: Transmission; beaconId?: string }) {
  const navigate = useNavigate();
  const live = useThreads((s) => (m.thread ? s.byId[m.thread.id] : undefined));
  const t = live ?? m.thread;
  if (!t || !beaconId) return null;
  return (
    <button
      type="button"
      aria-label={`Open thread ${t.title}`}
      onClick={() => navigate(threadPath(beaconId, t.relayId, t.id))}
      className="mt-1 flex w-full max-w-[480px] items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-left hover:bg-hover"
    >
      <MessagesSquare className="h-4 w-4 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate font-semibold text-fg">{t.title}</span>
      <span className="shrink-0 text-sm text-brand-sky">
        {t.messageCount} {t.messageCount === 1 ? 'Message' : 'Messages'}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" />
    </button>
  );
}

/** "X started a thread: Name" in the relay, for threads with no starter transmission. */
export function ThreadStartedMessage({ m, beaconId, onOpenProfile }: { m: Transmission; beaconId?: string; onOpenProfile: (e: React.MouseEvent) => void }) {
  const navigate = useNavigate();
  let info: { threadId?: string; name?: string } = {};
  try {
    info = JSON.parse(m.content);
  } catch {
    /* keep defaults */
  }
  const relayId = m.channelId;
  return (
    <div id={`msg-${m.id}`} role="note" className="flex items-center gap-4 py-1 pl-4 pr-12 text-sm text-fg-muted">
      <MessagesSquare className="ml-3 h-4 w-4 text-fg-subtle" />
      <span>
        <button className="font-semibold text-fg hover:underline" onClick={onOpenProfile}>
          <UserName user={m.author} beaconId={beaconId} styled={false} />
        </button>{' '}
        started a thread:{' '}
        <button className="font-semibold text-fg hover:underline" onClick={() => beaconId && info.threadId && navigate(threadPath(beaconId, relayId, info.threadId))}>
          {info.name}
        </button>
        . <span className="text-xs text-fg-subtle">{formatMessageTime(m.createdAt)}</span>
      </span>
    </div>
  );
}

