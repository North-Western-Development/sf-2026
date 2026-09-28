import { clsx } from 'clsx';
import { useStore } from '../../data/store';
import type { Presence, UserRef } from '../../lib/types';
import { PRESENCE_LABELS } from '../../lib/strings';

const PRESENCE_COLOR: Record<Presence, string> = {
  online: 'bg-online',
  idle: 'bg-idle',
  dnd: 'bg-danger',
  away: 'bg-away',
  invisible: 'bg-offline',
  offline: 'bg-offline',
};

/** Deterministic fallback tint so users without avatars are distinguishable. */
function fallbackHue(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export function PresenceDot({ status, size = 10, ring = 'var(--color-raised)' }: { status: Presence; size?: number; ring?: string }) {
  const visible = status === 'invisible' ? 'offline' : status;
  return (
    <span
      role="img"
      aria-label={PRESENCE_LABELS[visible]?.label ?? visible}
      className={clsx('block rounded-full', PRESENCE_COLOR[visible])}
      style={{ width: size, height: size, boxShadow: `0 0 0 3px ${ring}` }}
    />
  );
}

export function Avatar({
  user,
  size = 40,
  src,
  showPresence = false,
  ring,
  speaking,
  className,
}: {
  user: Pick<UserRef, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
  size?: number;
  /** Overrides user.avatarUrl (e.g. per-beacon avatar). */
  src?: string | null;
  showPresence?: boolean;
  ring?: string;
  speaking?: boolean;
  className?: string;
}) {
  const status = useStore((s) => (showPresence ? s.presence[user.id]?.status ?? 'offline' : 'offline'));
  const url = src ?? user.avatarUrl;
  const initial = (user.displayName || user.username || '?').trim().charAt(0).toUpperCase();
  const dot = Math.max(8, Math.round(size * 0.3));
  return (
    <span className={clsx('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      <span
        className={clsx(
          'flex h-full w-full items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none',
          speaking && 'ring-2 ring-online ring-offset-2 ring-offset-base'
        )}
        style={url ? undefined : { backgroundColor: `hsl(${fallbackHue(user.id)} 45% 38%)`, fontSize: size * 0.42 }}
      >
        {url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : initial}
      </span>
      {showPresence && (
        <span className="absolute" style={{ right: -1, bottom: -1 }}>
          <PresenceDot status={status} size={dot} ring={ring} />
        </span>
      )}
    </span>
  );
}

/** Red count pill used for mentions (Discord's mention badge). */
export function MentionBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={clsx(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white',
        className
      )}
      aria-label={`${count} mention${count === 1 ? '' : 's'}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
