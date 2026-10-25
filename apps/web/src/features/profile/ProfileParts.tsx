import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Tooltip } from '@subspace/ui';
import { useStore } from '../../data/store';
import { http } from '../../lib/http';
import { userTag } from '../../lib/normalize';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown } from '../chat/markdown';
import { useMarkdownResolvers } from '../chat/resolvers';
import { PixelStar } from '../auth/PixelStar';
import type { FullProfile } from './useProfile';

/** Discord-style section heading used across the popout, the self card and the full profile. */
export const profileHeading = 'mb-1 text-xs font-semibold text-fg-muted';

/** The custom status, as a thought bubble beside the avatar. */
export function StatusBubble({
  userId,
  fallback,
  onClick,
  placeholder,
}: {
  userId: string;
  fallback?: FullProfile['user']['customStatus'];
  onClick?: () => void;
  /** Shown when there is no status (the self card offers to set one). */
  placeholder?: string;
}) {
  const status = useStore((s) => s.presence[userId]?.customStatus ?? fallback);
  const text = status?.text;
  if (!text && !placeholder) return null;
  const content = (
    <>
      {text && status?.emoji && !status.emoji.startsWith('custom:') && <span className="mr-1">{status.emoji}</span>}
      {text || <span className="text-fg-muted">{placeholder}</span>}
    </>
  );
  const cls = 'relative block max-w-[190px] rounded-2xl bg-overlay px-3 py-2 text-left text-sm leading-snug text-fg shadow-pop ring-1 ring-line';
  return (
    <div className="relative w-fit">
      {/* Two trailing dots point the bubble at the avatar, like Discord's. */}
      <span aria-hidden className="absolute -left-2 bottom-1 h-2.5 w-2.5 rounded-full bg-overlay ring-1 ring-line" />
      <span aria-hidden className="absolute -left-3.5 -bottom-0.5 h-1.5 w-1.5 rounded-full bg-overlay ring-1 ring-line" />
      {onClick ? (
        <button type="button" onClick={onClick} aria-label={text ? 'Edit custom status' : 'Set a custom status'} className={clsx(cls, 'hover:bg-hover')}>
          {content}
        </button>
      ) : (
        <p className={cls} aria-label="Custom status">
          {content}
        </p>
      )}
    </div>
  );
}

/** Banner + avatar header shared by the popout, the self card and the full profile. */
export function ProfileHeader({
  profile,
  avatarSize = 80,
  bannerHeight = 105,
  bubble,
}: {
  profile: FullProfile;
  avatarSize?: number;
  bannerHeight?: number;
  /** Shown to the right of the avatar (the custom status). */
  bubble?: React.ReactNode;
}) {
  const u = profile.user;
  const banner = profile.member?.bannerUrl ?? u.bannerUrl;
  const avatarSrc = profile.member?.avatarUrl ?? u.avatarUrl;
  return (
    <div className="relative">
      <div className="w-full" style={{ height: bannerHeight, background: banner ? `center / cover no-repeat url("${banner}")` : u.bannerColor || 'var(--color-brand-strong)' }} />
      <div className="absolute left-4" style={{ top: bannerHeight - avatarSize / 2 }}>
        <Avatar user={{ ...u, avatarUrl: avatarSrc ?? null }} size={avatarSize} showPresence ring="var(--color-overlay)" className="rounded-full ring-[6px] ring-overlay" />
      </div>
      {bubble && (
        <div className="absolute right-3" style={{ left: 16 + avatarSize + 14, top: bannerHeight - avatarSize / 2 + 6 }}>
          {bubble}
        </div>
      )}
      <div style={{ height: avatarSize / 2 + 12 }} />
    </div>
  );
}

export function ProfileIdentity({ profile, beaconId, maxBadges }: { profile: FullProfile; beaconId?: string; maxBadges?: number }) {
  const u = profile.user;
  const pronouns = profile.member?.pronouns ?? u.pronouns;
  return (
    <div>
      <UserName user={u} beaconId={beaconId} className="block text-xl font-bold leading-tight" />
      <p className="text-sm text-fg">
        {userTag(u)}
        {pronouns && <span className="text-fg-muted"> • {pronouns}</span>}
      </p>
      <ProfileBadges profile={profile} max={maxBadges} className="mt-2" />
    </div>
  );
}

export function ProfileBio({ profile, beaconId }: { profile: FullProfile; beaconId?: string }) {
  const bio = profile.member?.bio ?? profile.user.bio;
  const resolvers = useMarkdownResolvers(beaconId);
  if (!bio) return null;
  return (
    <section>
      <h4 className={profileHeading}>About Me</h4>
      <div className="text-sm text-fg">
        <Markdown content={bio} resolvers={resolvers} />
      </div>
    </section>
  );
}

/** Full profile only: the Subspace mark and the beacon's icon, each with a date (Discord's layout). */
export function ProfileMeta({ profile, beaconId }: { profile: FullProfile; beaconId?: string }) {
  const beacon = useStore((s) => (beaconId ? s.beacons[beaconId] : undefined));
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
  const since = fmt(profile.user.createdAt);
  const joined = fmt(profile.member?.joinedAt);
  if (!since && !joined) return null;
  const beaconName = beacon?.name ?? 'This beacon';
  return (
    <section>
      <h4 className={profileHeading}>Member Since</h4>
      <p className="flex items-center gap-2 text-sm text-fg">
        {since && (
          <>
            <Tooltip content="Subspace Frequency">
              <span className="flex" role="img" aria-label="Subspace Frequency">
                <PixelStar size={16} />
              </span>
            </Tooltip>
            <span>{since}</span>
          </>
        )}
        {since && joined && <span className="text-fg-subtle">•</span>}
        {joined && (
          <>
            <Tooltip content={beaconName}>
              <span role="img" aria-label={beaconName} className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-[5px] bg-raised text-[8px] font-bold text-fg">
                {beacon?.iconUrl ? <img src={beacon.iconUrl} alt="" className="h-full w-full object-cover" /> : beaconName.slice(0, 1)}
              </span>
            </Tooltip>
            <span>{joined}</span>
          </>
        )}
      </p>
    </section>
  );
}

export function ProfileClearances({ profile }: { profile: FullProfile }) {
  const list = profile.member?.clearances ?? [];
  if (!list.length) return null;
  return (
    <section>
      <h4 className={profileHeading}>Clearances</h4>
      <div className="flex flex-wrap gap-1">
        {list.map((c) => (
          <span key={c.id} className="flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-xs text-fg">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
            {c.name}
          </span>
        ))}
      </div>
    </section>
  );
}

/** Badges in a compact strip; past `max`, the rest collapse into a "+N" chip. */
export function ProfileBadges({ profile, max, className }: { profile: FullProfile; max?: number; className?: string }) {
  const list = profile.commendations;
  if (!list.length) return null;
  const shown = max && list.length > max ? list.slice(0, max - 1) : list;
  const rest = list.slice(shown.length);
  return (
    <div role="list" aria-label="Badges" className={clsx('inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-void/40 p-1', className)}>
      {shown.map((c) => (
        <Tooltip key={c.code} content={c.name}>
          <span role="listitem" aria-label={c.name} className="flex h-[22px] w-[22px] items-center justify-center">
            <img src={c.iconUrl} alt="" className="h-[18px] w-[18px] [image-rendering:pixelated]" />
          </span>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip content={rest.map((c) => c.name).join(', ')}>
          <span role="listitem" aria-label={`${rest.length} more badges`} className="px-1 text-xs font-semibold text-fg-muted">
            +{rest.length}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/** Private per-viewer note (saved on blur). */
export function ProfileNote({ userId, initial }: { userId: string; initial: string | null }) {
  const [note, setNote] = useState(initial ?? '');
  const [saved, setSaved] = useState(initial ?? '');
  useEffect(() => {
    setNote(initial ?? '');
    setSaved(initial ?? '');
  }, [initial]);
  return (
    <section>
      <h4 className={profileHeading}>Note</h4>
      <textarea
        value={note}
        maxLength={256}
        rows={2}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note === saved) return;
          setSaved(note);
          void http.put(`/users/${userId}/note`, { note }).catch(() => {});
        }}
        placeholder="Click to add a note"
        aria-label="Note (only you can see this)"
        className="w-full resize-none rounded-sm bg-transparent px-1 py-0.5 text-xs text-fg outline-none placeholder:text-fg-subtle focus:bg-void"
      />
    </section>
  );
}
