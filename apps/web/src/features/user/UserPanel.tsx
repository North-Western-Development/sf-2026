import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Settings, Video, VideoOff } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { Tooltip } from '@subspace/ui';
import { useStore } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { openModal } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { useVoice, leaveVoice, toggleCamera, toggleScreenShare } from '../voice/session';
import { useAudioPrefs, toggleMute, toggleDeafen } from '../voice/audioPrefs';
import { SelfProfileCard } from './SelfProfileCard';
import { prefetchProfile } from '../profile/useProfile';
import { ActivityLine, useActivityOf } from '../activity/ActivityViews';


export function UserPanel() {
  const me = useStore((s) => s.me);
  const customStatus = useStore((s) => (me ? s.presence[me.id]?.customStatus ?? me.customStatus : null));
  const activity = useActivityOf(me?.id);
  const { muted, deafened } = useAudioPrefs();
  const anchor = useRef<HTMLButtonElement>(null);
  const [card, setCard] = useState<DOMRect | null>(null);
  const closeCard = useCallback(() => setCard(null), []);
  // Load my profile up front so the account card opens with its badges in place.
  useEffect(() => {
    if (me?.id) prefetchProfile(me.id);
  }, [me?.id]);
  if (!me) return null;

  return (
    // Spans the rail + sidebar; the split background lets both columns run behind the floating island.
    <div className="shrink-0 bg-[linear-gradient(to_right,var(--color-void)_72px,var(--color-raised)_72px)] px-2 pb-2">
      <div data-user-island className="flex flex-col rounded-lg bg-overlay shadow-pop">
        <VoiceStrip />
        <div className="flex h-[52px] items-center gap-1 px-1.5">
          <button
            ref={anchor}
            type="button"
            aria-label="Open your profile"
            aria-expanded={!!card}
            data-self-card-anchor
            onClick={() => setCard((open) => (open ? null : anchor.current!.closest('[data-user-island]')!.getBoundingClientRect()))}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-1 pr-2 text-left hover:bg-hover"
          >
            <Avatar user={me} size={32} showPresence ring="var(--color-overlay)" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight text-fg">{me.displayName || me.username}</span>
              <span className="block truncate text-xs leading-tight text-fg-subtle">
                {customStatus?.text || (activity ? <ActivityLine activity={activity} className="" /> : `#${me.discriminator}`)}
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
      {card && <SelfProfileCard anchor={card} onClose={closeCard} />}
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
  // In a comm-link, Video and Holo-Cast are separate permissions; calls allow both.
  const perms = useStore((s) => (v.relayId ? relayPermissions(s, v.relayId) : null));
  const canVideo = perms === null || can(perms, PERMISSIONS.BROADCAST_HOLO_CAST);
  const canShare = perms === null || can(perms, PERMISSIONS.SHARE_SCREEN);
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
      {(canVideo || canShare) && (
        <div className={clsx('mt-1.5 grid gap-1.5', canVideo && canShare ? 'grid-cols-2' : 'grid-cols-1')}>
          {canVideo && (
            <StripButton label={v.cameraOn ? 'Turn Off Camera' : 'Turn On Camera'} active={v.cameraOn} onClick={() => void toggleCamera()}>
              {v.cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </StripButton>
          )}
          {canShare && (
            <StripButton label={v.screenOn ? 'Stop Holo-Cast' : 'Holo-Cast Your Screen'} active={v.screenOn} onClick={() => void toggleScreenShare()}>
              <MonitorUp className="h-4 w-4" />
            </StripButton>
          )}
        </div>
      )}
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
