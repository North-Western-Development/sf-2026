import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { resolveName } from '../../lib/normalize';
import type { ChannelKey } from '../../lib/types';
import { useIsMobile } from '../../app/mobile';

export function typingText(names: string[]): string | null {
  if (!names.length) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]} are typing…`;
  return 'Several people are typing…';
}

/**
 * Who is typing. On a computer it sits in the gap under the message box; a phone has no gap there
 * (the box sits on the keyboard), so the composer shows it in a line above the box instead (`inline`),
 * only while someone is typing.
 */
export function TypingIndicator({ channelKey: key, beaconId, inline }: { channelKey: ChannelKey; beaconId?: string; inline?: boolean }) {
  const mobile = useIsMobile();
  const names = useStore(
    useShallow((s) =>
      Object.keys(s.typing[key] ?? {})
        .filter((id) => id !== s.me?.id)
        .map((id) => {
          const u = s.users[id];
          return u ? resolveName(u, beaconId ? s.members[beaconId]?.[id] : undefined) : 'Someone';
        })
    )
  );
  const text = typingText(names);
  if (mobile !== !!inline || (inline && !text)) return null;
  return (
    <div
      className={inline ? 'flex min-w-0 items-center gap-1.5 text-xs text-fg-muted' : 'absolute bottom-1 left-4 flex h-5 items-center gap-1.5 text-xs text-fg-muted'}
      aria-live="polite"
    >
      {text && (
        <>
          <span className="flex gap-0.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-muted" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </span>
          <span className="font-medium">{text}</span>
        </>
      )}
    </div>
  );
}
