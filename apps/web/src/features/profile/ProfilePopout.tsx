import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { MoreHorizontal, UserPlus, MessageCircle, Pencil } from 'lucide-react';
import { Tooltip, useContextMenu, Modal } from '@subspace/ui';
import { useUi, closePopout, closeModal, openModal, toast } from '../../app/ui';
import { openDirectLink, sendMessage } from '../../data/actions';
import { channelKey } from '../../lib/types';
import { http } from '../../lib/http';
import { memberMenu } from '../members/memberMenu';
import { useProfile, type FullProfile } from './useProfile';
import { ProfileActivity } from '../voice/ActivityParts';
import { ProfileConnections } from '../settings/user/ConnectionsTab';
import { ProfileBio, ProfileClearances, ProfileEffectLayer, ProfileHeader, ProfileIdentity, ProfileMeta, ProfileNote, StatusBubble, profileHeading } from './ProfileParts';
import { Avatar } from '../common/Avatar';
import { term } from '../../lib/strings';

export function themeStyle(p: FullProfile): React.CSSProperties | undefined {
  const primary = p.member?.themePrimary ?? p.user.themePrimary;
  const accent = p.member?.themeAccent ?? p.user.themeAccent;
  if (!primary && !accent) return undefined;
  return { background: `linear-gradient(180deg, ${primary ?? 'var(--color-overlay)'}, ${accent ?? primary})` };
}

function useDirectMessage(userId: string) {
  const navigate = useNavigate();
  return async (text?: string) => {
    try {
      const linkId = await openDirectLink(userId);
      if (text) await sendMessage(channelKey('link', linkId), text);
      closePopout();
      closeModal();
      navigate(`/channels/@me/${linkId}`);
    } catch {
      toast('You cannot open a Direct Link with this transmitter.', 'error');
    }
  };
}

function Popout({ userId, beaconId, rect, side }: { userId: string; beaconId?: string; rect: { top: number; left: number; right: number; bottom: number }; side: 'left' | 'right' }) {
  const profile = useProfile(userId, beaconId);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -9999, y: -9999 });
  const [message, setMessage] = useState('');
  const dm = useDirectMessage(userId);
  const navigate = useNavigate();
  const { openContextMenu } = useContextMenu();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = side === 'right' ? rect.right + 12 : rect.left - w - 12;
    if (x + w > window.innerWidth - 8) x = rect.left - w - 12;
    if (x < 8) x = Math.min(rect.right + 12, window.innerWidth - w - 8);
    const y = Math.max(8, Math.min(rect.top, window.innerHeight - h - 8));
    // The fallback profile is a new object each render until the fetch lands; keep the same
    // state when nothing moved so this effect does not loop.
    setPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [rect, side, profile]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest?.('[data-context-menu]')) closePopout();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closePopout();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  if (!profile) return null;
  const self = profile.relationship === 'self';

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${profile.user.displayName || profile.user.username} profile`}
      data-context-menu
      className="fixed z-[1100] w-[300px] overflow-hidden rounded-xl bg-overlay shadow-pop animate-[fade-in_100ms_ease-out]"
      style={{ left: pos.x, top: pos.y, ...themeStyle(profile) }}
    >
      <ProfileEffectLayer profile={profile} />
      <ProfileHeader profile={profile} bubble={<StatusBubble userId={userId} fallback={(profile.user as FullProfile['user']).customStatus} />} />
      <div className="absolute right-2 top-2 flex gap-1">
        {profile.relationship === 'none' && (
          <Tooltip content={`Add ${term('affiliate')}`}>
            <button
              type="button"
              aria-label={`Add ${term('affiliate')}`}
              onClick={() => void http.post('/affiliations/request', { targetId: userId }).then(() => toast('Affiliation request sent')).catch((e) => toast(e.message, 'error'))}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-void/70 text-fg hover:bg-void"
            >
              <UserPlus className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
        <Tooltip content="More">
          <button
            type="button"
            aria-label="More"
            onClick={(e) => openContextMenu({ clientX: e.clientX, clientY: e.clientY }, memberMenu(beaconId, userId, navigate))}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-void/70 text-fg hover:bg-void"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
      <div className="m-3 mt-0 space-y-3 rounded-lg bg-void/60 p-3">
        <ProfileIdentity profile={profile} beaconId={beaconId} maxBadges={8} />
        <ProfileBio profile={profile} beaconId={beaconId} />
        <ProfileClearances profile={profile} />
        <ProfileActivity userId={userId} beaconId={beaconId} onJoined={closePopout} />
        {!self && <ProfileNote userId={userId} initial={profile.note} />}
        {self ? (
          <button
            type="button"
            onClick={() => {
              closePopout();
              openModal({ kind: 'userSettings', tab: 'profile' });
            }}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-raised py-2 text-sm font-medium text-fg hover:bg-hover"
          >
            <Pencil className="h-4 w-4" /> Edit Profile
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim()) void dm(message.trim());
            }}
          >
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Transmit to @${profile.user.displayName || profile.user.username}`}
              aria-label="Send a direct transmission"
              className="h-10 w-full rounded-md border border-line bg-raised px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-brand"
            />
          </form>
        )}
        <button
          type="button"
          onClick={() => {
            closePopout();
            openModal({ kind: 'profile', userId, beaconId });
          }}
          className="w-full text-center text-xs text-fg-muted hover:text-fg hover:underline"
        >
          View Full Profile
        </button>
      </div>
    </div>,
    document.body
  );
}

export function ProfilePopoutHost() {
  const popout = useUi((s) => s.popout);
  if (!popout) return null;
  return <Popout key={`${popout.userId}:${popout.beaconId}`} {...popout} />;
}

export function ProfileModal({ userId, beaconId }: { userId: string; beaconId?: string }) {
  const profile = useProfile(userId, beaconId);
  const [tab, setTab] = useState<'about' | 'beacons' | 'friends'>('about');
  const navigate = useNavigate();
  const dm = useDirectMessage(userId);
  const { openContextMenu } = useContextMenu();
  if (!profile) return null;
  const self = profile.relationship === 'self';

  return (
    <Modal isOpen onClose={closeModal} maxWidth="2xl" className="!bg-overlay">
      <div className="relative -mx-6 -my-4" style={themeStyle(profile)}>
        <ProfileEffectLayer profile={profile} />
        <ProfileHeader profile={profile} avatarSize={120} bannerHeight={180} bubble={<StatusBubble userId={userId} fallback={(profile.user as FullProfile['user']).customStatus} />} />
        <div className="flex items-start justify-between gap-4 px-6">
          <ProfileIdentity profile={profile} beaconId={beaconId} />
          <div className="flex shrink-0 gap-2">
            {!self && (
              <button type="button" onClick={() => void dm()} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand hover:bg-brand-strong">
                <MessageCircle className="h-4 w-4" /> Message
              </button>
            )}
            {profile.relationship === 'none' && (
              <button
                type="button"
                onClick={() => void http.post('/affiliations/request', { targetId: userId }).then(() => toast('Affiliation request sent')).catch((e) => toast(e.message, 'error'))}
                className="flex items-center gap-1.5 rounded-md bg-online px-3 py-1.5 text-sm font-medium text-void hover:brightness-110"
              >
                <UserPlus className="h-4 w-4" /> Add {term('affiliate')}
              </button>
            )}
            <button
              type="button"
              aria-label="More"
              onClick={(e) => openContextMenu({ clientX: e.clientX, clientY: e.clientY }, memberMenu(beaconId, userId, navigate))}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-raised text-fg hover:bg-hover"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mx-6 mb-6 mt-4 rounded-lg bg-void/60">
          <nav className="flex gap-6 border-b border-line px-4" aria-label="Profile sections">
            {(
              [
                ['about', 'About Me'],
                ['beacons', `${profile.mutualBeacons.length} Mutual ${term('beacon', true)}`],
                ['friends', `${profile.mutualFriends.length} Mutual ${term('affiliate', true)}`],
              ] as const
            )
              .filter(([id]) => !self || id === 'about')
              .map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                  className={clsx('border-b-2 py-3 text-sm font-medium', tab === id ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
                >
                  {label}
                </button>
              ))}
          </nav>
          <div className="max-h-[40vh] space-y-4 overflow-y-auto p-4">
            {tab === 'about' && (
              <>
                <ProfileBio profile={profile} beaconId={beaconId} />
                <ProfileMeta profile={profile} beaconId={beaconId} />
                <ProfileClearances profile={profile} />
                <ProfileConnections connections={'connections' in profile ? profile.connections : undefined} heading={profileHeading} />
                {!self && <ProfileNote userId={userId} initial={profile.note} />}
              </>
            )}
            {tab === 'beacons' &&
              (profile.mutualBeacons.length ? (
                profile.mutualBeacons.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      closeModal();
                      navigate(`/channels/${b.id}`);
                    }}
                    className="flex h-12 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-hover"
                  >
                    <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-raised font-bold">
                      {b.iconUrl ? <img src={b.iconUrl} alt="" className="h-full w-full object-cover" /> : b.name[0]}
                    </span>
                    <span className="text-fg">{b.name}</span>
                    {b.nickname && <span className="text-sm text-fg-subtle">{b.nickname}</span>}
                  </button>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-fg-subtle">No {term('beacon', true).toLowerCase()} in common.</p>
              ))}
            {tab === 'friends' &&
              (profile.mutualFriends.length ? (
                profile.mutualFriends.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => openModal({ kind: 'profile', userId: f.id })}
                    className="flex h-12 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-hover"
                  >
                    <Avatar user={f} size={32} showPresence />
                    <span className="text-fg">{f.displayName || f.username}</span>
                  </button>
                ))
              ) : (
                <p className="py-6 text-center text-sm text-fg-subtle">No {term('affiliate', true).toLowerCase()} in common.</p>
              ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
