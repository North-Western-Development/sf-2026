import { useEffect, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import type { Activity } from '@subspace/constants';
import { useStore } from '../../data/store';
import { ACTIVITY_VERBS, elapsed, remaining, safeActivityImage } from './activity';

/** What they are playing, when I may see it (never while they show as offline). */
export const useActivityOf = (userId: string | undefined) =>
  useStore((s) => {
    const p = userId ? s.presence[userId] : undefined;
    return p && p.status !== 'offline' && p.status !== 'invisible' ? p.activity ?? null : null;
  });

/** Re-renders every so often so "for 42m" keeps counting. */
function useNow(everyMs: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** "Playing Counter-Strike 2" in a list row (member list, Direct Links, friends). */
export function ActivityLine({ activity, className }: { activity: Activity; className?: string }) {
  return (
    <span className={className ?? 'block truncate text-xs text-fg-subtle'} title={`${ACTIVITY_VERBS[activity.type]} ${activity.name}`}>
      {ACTIVITY_VERBS[activity.type]} <strong className="font-semibold">{activity.name}</strong>
    </span>
  );
}

/** The profile's activity section: art, name, the two lines, party, time, buttons. */
export function ActivityCard({ activity }: { activity: Activity }) {
  const now = useNow(activity.endsAt ? 1000 : 30_000);
  const large = safeActivityImage(activity.largeImage);
  const small = safeActivityImage(activity.smallImage);
  const time = activity.endsAt ? remaining(activity.endsAt, now) : activity.startedAt ? `for ${elapsed(activity.startedAt, now)}` : null;
  // A detected game's art is its Steam cover, which is portrait, unless its verified application's icon.
  const cover = activity.source === 'detected' && !activity.applicationId && !!large;
  return (
    <section aria-label="Activity" className="rounded-lg bg-void/40 p-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-fg-muted">{ACTIVITY_VERBS[activity.type]}</h3>
      <div className="flex items-center gap-3">
        <div className={`relative shrink-0 ${cover ? 'h-[72px] w-12' : 'h-16 w-16'}`}>
          {large ? (
            <img
              src={large}
              alt={activity.largeText ?? ''}
              title={activity.largeText}
              className={`${cover ? 'h-[72px] w-12 rounded-md' : 'h-16 w-16 rounded-lg'} object-cover`}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-active text-fg-muted">
              <Gamepad2 className="h-8 w-8" aria-hidden />
            </span>
          )}
          {small && (
            <img
              src={small}
              alt={activity.smallText ?? ''}
              title={activity.smallText}
              className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full border-2 border-raised object-cover"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
        <div className="min-w-0 text-sm leading-snug">
          <p className="truncate font-semibold text-fg">{activity.name}</p>
          {activity.details && <p className="truncate text-fg-muted">{activity.details}</p>}
          {(activity.state || activity.party) && (
            <p className="truncate text-fg-muted">
              {activity.state}
              {activity.party && ` (${activity.party.size} of ${activity.party.max})`}
            </p>
          )}
          {time && <p className="text-xs text-fg-subtle">{time}</p>}
        </div>
      </div>
      {activity.buttons && (
        <div className="mt-3 grid gap-2">
          {activity.buttons.map((b) => (
            <a
              key={b.url}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block truncate rounded-md bg-active px-3 py-1.5 text-center text-sm font-medium text-fg hover:bg-hover"
            >
              {b.label}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

/** On profiles: their current activity, or nothing. */
export function ProfileGameActivity({ userId }: { userId: string }) {
  const activity = useActivityOf(userId);
  return activity ? <ActivityCard activity={activity} /> : null;
}
