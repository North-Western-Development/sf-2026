import { Emoji } from '../../lib/emoji';
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Tooltip } from '@subspace/ui';
import { useStore } from '../../data/store';
import { http } from '../../lib/http';
import { userTag } from '../../lib/normalize';
import { Avatar } from '../common/Avatar';
import { BeaconTag } from '../common/BeaconTag';
import { ProfileEffect } from '../common/Decorations';
import { UserName } from '../common/UserName';
import { AppTag } from '../common/AppTag';
import { PERMISSIONS } from '../../data/permissions';
import { NotebookPen, Plus, Reply, Smile } from 'lucide-react';
import { EmojiPicker } from '../chat/EmojiPicker';
import { Markdown } from '../chat/markdown';
import { useMarkdownResolvers } from '../chat/resolvers';
import { PixelStar } from '../auth/PixelStar';
import type { FullProfile } from './useProfile';
import type { CustomStatus } from '../../lib/types';

/** Discord-style section heading used across the popout, the self card and the full profile. */
export const profileHeading = 'mb-1 text-xs font-semibold text-fg-muted';

/** The custom status, as a thought bubble beside the avatar. */
export function StatusBubble({
  userId,
  fallback,
  onClick,
  placeholder,
  draft,
  onReact,
  onReply,
}: {
  userId: string;
  fallback?: FullProfile['user']['customStatus'];
  onClick?: () => void;
  /** Shown when there is no status (the self card offers to set one). */
  placeholder?: string;
  /** A status being typed (the status dialog's preview), shown instead of the saved one. */
  draft?: CustomStatus | null;
  /** Someone else's status: answer it with an emoji, or a reply that quotes it (in a Direct Link). */
  onReact?: (statusText: string, emoji: string) => void;
  onReply?: (statusText: string) => void;
}) {
  const saved = useStore((s) => s.presence[userId]?.customStatus ?? fallback);
  const status = draft !== undefined ? draft : saved;
  const text = status?.text;
  const [hover, setHover] = useState(false);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  if (!text && !placeholder) return null;
  const content = (
    <>
      {text && status?.emoji && !status.emoji.startsWith('custom:') && <Emoji emoji={status.emoji} size={18} className="mr-1" />}
      {text || <span className="text-fg-muted">{placeholder}</span>}
    </>
  );
  // Two lines at most (long words break); hovering shows all of it.
  // (line-clamp sets its own display: adding `block` would undo the clamp.)
  const cls = clsx(
    'relative max-w-[190px] rounded-2xl bg-overlay px-3 py-2 text-left text-sm leading-snug text-fg shadow-pop ring-1 ring-line [overflow-wrap:anywhere]',
    hover ? 'block' : 'line-clamp-2'
  );
  const actions = !!text && !onClick && (onReact || onReply);
  return (
    <div className="relative w-fit" onPointerEnter={() => setHover(true)} onPointerLeave={() => !picker && setHover(false)}>
      {/* Two trailing dots point the bubble at the avatar, like Discord's. */}
      <span aria-hidden className="absolute -left-2 bottom-1 h-2.5 w-2.5 rounded-full bg-overlay ring-1 ring-line" />
      <span aria-hidden className="absolute -left-3.5 -bottom-0.5 h-1.5 w-1.5 rounded-full bg-overlay ring-1 ring-line" />
      {onClick ? (
        <button type="button" onClick={onClick} aria-label={text ? 'Edit custom status' : 'Set a custom status'} className={clsx(cls, 'hover:bg-hover')}>
          {content}
        </button>
      ) : (
        <>
          {/* Expanded, it grows upward over the banner, never over the name and buttons below. */}
          {hover && (
            <p aria-hidden className={clsx(cls, 'invisible line-clamp-2')}>
              {content}
            </p>
          )}
          <p className={clsx(cls, hover && 'absolute bottom-0 left-0 z-20 w-[190px]')} aria-label="Custom status" title={hover ? undefined : text}>
            {content}
          </p>
        </>
      )}
      {actions && (hover || picker) && (
        <div role="toolbar" aria-label="Answer status" className="absolute -bottom-3 right-1 z-30 flex gap-0.5 rounded-lg bg-overlay p-0.5 shadow-pop ring-1 ring-line">
          {onReact && (
            <button type="button" aria-label="React to status" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())} className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg">
              <Smile className="h-4 w-4" aria-hidden />
            </button>
          )}
          {onReply && (
            <button type="button" aria-label="Reply to status" onClick={() => onReply(text!)} className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg">
              <Reply className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      )}
      {picker && onReact && (
        <EmojiPicker
          anchor={picker}
          glyphs="none"
          onPick={(emoji) => {
            setPicker(null);
            setHover(false);
            onReact(text!, emoji);
          }}
          onClose={() => {
            setPicker(null);
            setHover(false);
          }}
        />
      )}
    </div>
  );
}

/** A Direct Link answer to someone's status: the status quoted, then what you say. */
export const quoteStatus = (statusText: string, reply = '') => `${statusText.split('\n').map((l) => `> ${l}`).join('\n')}\n${reply}`;

/** Their profile effect over the whole card; follows live USER_UPDATEs. */
export function ProfileEffectLayer({ profile }: { profile: FullProfile }) {
  const live = useStore((s) => s.users[profile.user.id]?.profileEffect);
  return <ProfileEffect name={live !== undefined ? live : profile.user.profileEffect} />;
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
      <div className="flex flex-wrap items-center gap-2">
        <UserName user={u} beaconId={beaconId} className="block text-xl font-bold leading-tight" />
        <AppTag user={u} />
        {!u.botKind && (
          <Tooltip content={profile.note ? 'Edit Note (only visible to you)' : 'Add Note (only visible to you)'}>
            <button
              type="button"
              aria-label={profile.note ? 'Edit Note' : 'Add Note'}
              onClick={(e) => noteBoxNear(e.currentTarget, u.id)?.focus()}
              className="rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <NotebookPen className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-1 text-sm text-fg">
        {userTag(u)}
        <BeaconTag beaconId={u.tagBeaconId} />
        {pronouns && <span className="text-fg-muted"> • {pronouns}</span>}
      </p>
      <ProfileBadges profile={profile} max={maxBadges} className="mt-2" />
    </div>
  );
}

/** The permissions an Add App link asks for by default; whoever adds the bot can untick any. */
const ADD_APP_PERMISSIONS = (PERMISSIONS.VIEW_RELAY | PERMISSIONS.SEND_TRANSMISSIONS | PERMISSIONS.READ_HISTORY | PERMISSIONS.ADD_REACTIONS | PERMISSIONS.EMBED_LINKS).toString();

/**
 * A bot's profile: Add App (only when its developer lets anyone add it, or I am one of its
 * developers) and its slash commands, as Discord shows them.
 */
export function ProfileApp({ profile }: { profile: FullProfile }) {
  const a = profile.application;
  if (!a) return null;
  return (
    <div className="mt-3">
      {a.canAdd && (
        <a
          href={`/oauth2/authorize?client_id=${a.id}&scope=bot&permissions=${ADD_APP_PERMISSIONS}`}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-active text-sm font-medium text-fg hover:bg-hover"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add App
        </a>
      )}
      {a.commands.length > 0 && (
        <section aria-label="Commands" className="mt-3">
          <h3 className={profileHeading}>Commands</h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {a.commands.map((c) => (
              <li key={c.name} title={c.description} className="rounded-md bg-void/50 px-2 py-1 text-xs font-medium text-fg ring-1 ring-line">
                /{c.name}
              </li>
            ))}
          </ul>
        </section>
      )}
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
/** The note box in the same profile (popout, panel or full profile) as `from`: several can be open at once. */
export const noteBoxNear = (from: HTMLElement, userId: string) =>
  from.closest('[role="dialog"], aside')?.querySelector<HTMLTextAreaElement>(`textarea[data-note-for="${userId}"]`) ?? null;

export function ProfileNote({ userId, initial, maxLength = 1024 }: { userId: string; initial: string | null; maxLength?: number }) {
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
        data-note-for={userId}
        value={note}
        maxLength={maxLength}
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
