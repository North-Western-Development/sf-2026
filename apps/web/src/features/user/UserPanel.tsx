import { useRef } from 'react';
import { clsx } from 'clsx';
import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Settings, Video, VideoOff } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { Tooltip, useContextMenu, type ContextMenuItem } from '@subspace/ui';
import { create } from 'zustand';
import { useStore } from '../../data/store';
import { setMyPresence, signOut } from '../../data/actions';
import { openModal } from '../../app/ui';
import { PRESENCE_LABELS } from '../../lib/strings';
import { userTag } from '../../lib/normalize';
import { Avatar, PresenceDot } from '../common/Avatar';
import type { Presence } from '../../lib/types';
import { useVoice, leaveVoice, toggleCamera, toggleScreenShare } from '../voice/session';
import { copyText } from '../../lib/clipboard';

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
        void copyText(userTag(me), 'Tag copied');
      },
    },
    { label: 'Log Out', danger: true, onClick: () => void signOut() },
  ];

  return (
    // Spans the rail + sidebar; the split background lets both columns run behind the floating island.
    <div className="shrink-0 bg-[linear-gradient(to_right,var(--color-void)_72px,var(--color-raised)_72px)] px-2 pb-2">
      <div className="flex flex-col rounded-lg bg-overlay shadow-pop">
        <VoiceStrip />
        <div className="flex h-[52px] items-center gap-1 px-1.5">
          <button
            ref={anchor}
            type="button"
            aria-label="Set status"
            onClick={() => {
              const r = anchor.current!.getBoundingClientRect();
              openContextMenu({ clientX: r.left, clientY: r.top - 8 }, statusMenu());
            }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-1 pr-2 text-left hover:bg-hover"
          >
            <Avatar user={me} size={32} showPresence ring="var(--color-overlay)" />
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
      </div>
    </div>
  );
}

/** "Comm-Link Connected" block stacked above the user row while in voice (Discord's RTC panel). */
function VoiceStrip() {
  const navigate = useNavigate();
  const v = useVoice(useShallow((s) => ({ relayId: s.relayId, beaconId: s.beaconId, callKey: s.callKey, state: s.state, cameraOn: s.cameraOn, screenOn: s.screenOn })));
  const relayName = useStore((s) => (v.relayId ? s.relays[v.relayId]?.name : undefined));
  const beaconName = useStore((s) => (v.beaconId ? s.beacons[v.beaconId]?.name : undefined));
  const callName = useStore((s) => {
    if (!v.callKey) return undefined;
    const id = v.callKey.slice(v.callKey.indexOf(':') + 1);
    const peer = s.links[id]?.recipient;
    return peer ? `@${peer.displayName || peer.username}` : s.meshes[id]?.name || 'Subspace Mesh';
  });
  if (!v.relayId && !v.callKey) return null;
  const connected = v.state === 'connected';
  const target = v.callKey ? `/channels/@me/${v.callKey.slice(v.callKey.indexOf(':') + 1)}` : `/channels/${v.beaconId}/${v.relayId}`;
  return (
    <div className="border-b border-line px-2 pb-2 pt-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate(target)}
          className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-hover"
        >
          <span className={clsx('block text-sm font-semibold leading-tight', connected ? 'text-online' : 'text-warning')}>
            {connected ? (v.callKey ? 'Voice Connected' : 'Comm-Link Connected') : v.state === 'reconnecting' ? 'Reconnecting...' : 'Connecting...'}
          </span>
          <span className="block truncate text-xs leading-tight text-fg-subtle">
            {v.callKey ? callName : relayName ?? 'Comm-Link'}
            {!v.callKey && beaconName ? ` / ${beaconName}` : ''}
          </span>
        </button>
        <PanelButton label="Disconnect" onClick={() => void leaveVoice()}>
          <PhoneOff className="h-5 w-5" />
        </PanelButton>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <StripButton label={v.cameraOn ? 'Turn Off Camera' : 'Turn On Camera'} active={v.cameraOn} onClick={() => void toggleCamera()}>
          {v.cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </StripButton>
        <StripButton label={v.screenOn ? 'Stop Holo-Cast' : 'Holo-Cast Your Screen'} active={v.screenOn} onClick={() => void toggleScreenShare()}>
          <MonitorUp className="h-4 w-4" />
        </StripButton>
      </div>
    </div>
  );
}

function StripButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={clsx('flex h-8 items-center justify-center rounded-md', active ? 'bg-online text-void' : 'bg-raised text-fg-muted hover:bg-hover hover:text-fg')}
      >
        {children}
      </button>
    </Tooltip>
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
