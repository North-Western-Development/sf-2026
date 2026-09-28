import { useRef } from 'react';
import { clsx } from 'clsx';
import { Headphones, HeadphoneOff, Mic, MicOff, Settings } from 'lucide-react';
import { Tooltip, useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { create } from 'zustand';
import { useStore } from '../../data/store';
import { setMyPresence, signOut } from '../../data/actions';
import { openModal, toast } from '../../app/ui';
import { PRESENCE_LABELS } from '../../lib/strings';
import { userTag } from '../../lib/normalize';
import { Avatar, PresenceDot } from '../common/Avatar';
import type { Presence } from '../../lib/types';

/** Local audio device state (mirrored into the voice session when connected). */
export const useAudioPrefs = create<{ muted: boolean; deafened: boolean }>()(() => ({ muted: false, deafened: false }));

export function toggleMute() {
  const { muted, deafened } = useAudioPrefs.getState();
  // Unmuting while deafened also undeafens (Discord behaviour).
  if (muted && deafened) useAudioPrefs.setState({ muted: false, deafened: false });
  else useAudioPrefs.setState({ muted: !muted });
}
export function toggleDeafen() {
  const { deafened } = useAudioPrefs.getState();
  useAudioPrefs.setState(deafened ? { deafened: false, muted: false } : { deafened: true, muted: true });
}

const STATUSES: Presence[] = ['online', 'idle', 'dnd', 'invisible'];

export function UserPanel() {
  const me = useStore((s) => s.me);
  const status = useStore((s) => (me ? s.presence[me.id]?.status ?? 'online' : 'online'));
  const customStatus = useStore((s) => (me ? s.presence[me.id]?.customStatus ?? me.customStatus : null));
  const { muted, deafened } = useAudioPrefs();
  const { openContextMenu } = useContextMenu();
  const anchor = useRef<HTMLButtonElement>(null);
  if (!me) return null;

  const statusMenu = (): ContextMenuItem[] => [
    { heading: true, label: userTag(me) },
    ...STATUSES.map<ContextMenuItem>((st) => ({
      label: PRESENCE_LABELS[st].label,
      sublabel: PRESENCE_LABELS[st].description,
      icon: <PresenceDot status={st} size={10} ring="transparent" />,
      checked: status === st,
      onClick: () => setMyPresence(st),
    })),
    { separator: true },
    { label: customStatus?.text ? 'Edit Custom Status' : 'Set Custom Status', onClick: () => openModal({ kind: 'userSettings', tab: 'status' }) },
    { label: 'Edit Profile', onClick: () => openModal({ kind: 'userSettings', tab: 'profile' }) },
    { separator: true },
    {
      label: 'Copy Tag',
      onClick: () => {
        void navigator.clipboard?.writeText(userTag(me));
        toast('Tag copied');
      },
    },
    { label: 'Log Out', danger: true, onClick: () => void signOut() },
  ];

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1 bg-void/60 px-2">
      <button
        ref={anchor}
        type="button"
        aria-label="Set status"
        onClick={() => {
          const r = anchor.current!.getBoundingClientRect();
          openContextMenu({ clientX: r.left, clientY: r.top - 8 }, statusMenu());
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-0.5 pr-2 text-left hover:bg-hover"
      >
        <Avatar user={me} size={32} showPresence ring="var(--color-void)" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight text-fg">{me.displayName || me.username}</span>
          <span className="block truncate text-xs leading-tight text-fg-subtle">
            {customStatus?.text || `#${me.discriminator}`}
          </span>
        </span>
      </button>
      <PanelButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={toggleMute}>
        {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
      </PanelButton>
      <PanelButton label={deafened ? 'Undeafen' : 'Deafen'} active={deafened} onClick={toggleDeafen}>
        {deafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
      </PanelButton>
      <PanelButton label="User Settings" onClick={() => openModal({ kind: 'userSettings' })}>
        <Settings className="h-5 w-5" />
      </PanelButton>
    </div>
  );
}

function PanelButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={clsx('flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover', active ? 'text-danger' : 'text-fg-muted hover:text-fg')}
      >
        {children}
      </button>
    </Tooltip>
  );
}
