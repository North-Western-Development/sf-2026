import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Award, ChevronRight, CircleUserRound, Clapperboard, IdCard, Pencil } from 'lucide-react';
import { useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { useStore } from '../../data/store';
import { setMyPresence } from '../../data/actions';
import { openModal } from '../../app/ui';
import { copyText } from '../../lib/clipboard';
import { PRESENCE_LABELS } from '../../lib/strings';
import type { Presence } from '../../lib/types';
import { PresenceDot } from '../common/Avatar';
import { useProfile, type FullProfile } from '../profile/useProfile';
import { ProfileEffectLayer, ProfileHeader, ProfileIdentity, StatusBubble } from '../profile/ProfileParts';
import { themeStyle } from '../profile/ProfilePopout';

const STATUSES: Presence[] = ['online', 'idle', 'dnd', 'invisible'];

/**
 * Discord's account card: opens from the user panel. Profile header, badges, then the
 * account actions (edit profile, presence, badges, copy ID). Discord-only extras stay as
 * greyed placeholders.
 */
export function SelfProfileCard({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const me = useStore((s) => s.me);
  const status = useStore((s) => (me ? s.presence[me.id]?.status ?? 'online' : 'online'));
  const profile = useProfile(me?.id ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const { openContextMenu } = useContextMenu();

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // The panel button toggles the card itself; the status flyout is a context menu.
      if (ref.current?.contains(t) || t.closest?.('[data-context-menu]') || t.closest?.('[data-self-card-anchor]')) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  if (!me || !profile) return null;
  const go = (tab: string) => {
    onClose();
    openModal({ kind: 'userSettings', tab });
  };
  const visible = status === 'invisible' ? 'invisible' : status;

  const statusMenu = (): ContextMenuItem[] =>
    STATUSES.map((st) => ({
      label: PRESENCE_LABELS[st].label,
      sublabel: PRESENCE_LABELS[st].description,
      icon: <PresenceDot status={st} size={10} ring="transparent" />,
      checked: status === st,
      onClick: () => setMyPresence(st),
    }));
  const openStatus = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    openContextMenu({ clientX: r.right + 8, clientY: r.top - 4 }, statusMenu());
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Your profile"
      data-context-menu
      className="fixed z-[1100] w-[340px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl bg-overlay shadow-pop ring-1 ring-line animate-[fade-in_100ms_ease-out]"
      style={{ left: Math.max(8, anchor.left), bottom: window.innerHeight - anchor.top + 8, ...themeStyle(profile as FullProfile) }}
    >
      <ProfileEffectLayer profile={profile as FullProfile} />
      <ProfileHeader
        profile={profile}
        bubble={<StatusBubble userId={me.id} fallback={me.customStatus} placeholder="Set a status" onClick={() => (onClose(), openModal({ kind: 'status' }))} />}
      />
      <div className="px-4">
        <ProfileIdentity profile={profile} maxBadges={8} />
      </div>

      <div className="m-3 space-y-2">
        <div className="divide-y divide-line rounded-lg bg-void/60 p-1.5">
          <CardRow icon={<Pencil />} label="Edit Profile" onClick={() => go('profile')} />
          <CardRow
            icon={<PresenceDot status={visible} size={10} ring="transparent" />}
            label={PRESENCE_LABELS[visible]?.label ?? 'Online'}
            aria-label={`Status: ${PRESENCE_LABELS[visible]?.label ?? 'Online'}`}
            chevron
            onClick={(e) => openStatus(e.currentTarget)}
          />
          <CardRow
            icon={<Award />}
            label="Badges"
            onClick={() => {
              onClose();
              openModal({ kind: 'badges' });
            }}
          />
          <CardRow
            icon={<Clapperboard />}
            label="Clips"
            onClick={() => {
              onClose();
              openModal({ kind: 'clips' });
            }}
          />
        </div>
        <div className="divide-y divide-line rounded-lg bg-void/60 p-1.5">
          <CardRow
            icon={<CircleUserRound />}
            label="Switch Accounts"
            chevron
            onClick={() => {
              onClose();
              openModal({ kind: 'switchAccounts' });
            }}
          />
          <CardRow
            icon={<IdCard />}
            label="Copy User ID"
            onClick={() => {
              void copyText(me.id, 'User ID copied');
              onClose();
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

const rowClass = 'flex h-10 w-full items-center gap-3 rounded-md px-2 text-left text-sm font-medium text-fg-muted hover:bg-hover hover:text-fg [&>svg:first-child]:h-[18px] [&>svg:first-child]:w-[18px]';

function CardRow({
  icon,
  label,
  chevron,
  onClick,
  'aria-label': ariaLabel,
}: {
  icon: React.ReactNode;
  label: string;
  chevron?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  'aria-label'?: string;
}) {
  return (
    <div className="py-0.5 first:pt-0 last:pb-0">
      <button type="button" onClick={onClick} aria-label={ariaLabel} className={rowClass}>
        <span className="flex w-[18px] justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {chevron && <ChevronRight className="h-4 w-4" />}
      </button>
    </div>
  );
}
