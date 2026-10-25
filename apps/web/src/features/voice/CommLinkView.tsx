import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { X, Lock, MessageSquare, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff, Headphones, HeadphoneOff, Volume2, Users as UsersIcon } from 'lucide-react';
import type { Track } from 'livekit-client';
import { ComingSoon, Tooltip } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore, setState } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { channelKey, type Relay } from '../../lib/types';
import { resolveName } from '../../lib/normalize';
import { term } from '../../lib/strings';
import { useVoice, joinVoice, leaveVoice, toggleCamera, toggleScreenShare } from './session';
import { useAudioPrefs, toggleMute, toggleDeafen } from './audioPrefs';
import { Avatar } from '../common/Avatar';
import { MessageList } from '../chat/MessageList';
import { Composer } from '../chat/Composer';
import { TypingIndicator } from '../chat/TypingIndicator';
import { useUi } from '../../app/ui';
import { MobileNavButton } from '../../app/mobile';
import { SoundboardButton } from './SoundboardButton';
import { ControlButton } from './ControlButton';

function VideoSurface({ track, mirrored }: { track: Track; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={clsx('h-full w-full object-contain', mirrored && '-scale-x-100')} />;
}

export function Tile({ userId, beaconId }: { userId: string; beaconId?: string }) {
  const user = useStore((s) => s.users[userId]);
  const member = useStore((s) => (beaconId ? s.members[beaconId]?.[userId] : undefined));
  const vs = useStore((s) => s.voice[userId]);
  const speaking = useVoice((s) => s.speaking.includes(userId));
  const tracks = useVoice((s) => s.tracks[userId]);
  const meId = useStore((s) => s.me?.id);
  const name = user ? resolveName(user, member) : vs?.username ?? 'Transmitter';
  const video = tracks?.screen ?? tracks?.camera ?? null;
  return (
    <div
      role="group"
      aria-label={name}
      data-speaking={speaking && !vs?.isMuted ? 'true' : undefined}
      className={clsx(
        'relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-raised',
        speaking && !vs?.isMuted ? 'ring-2 ring-online' : 'ring-1 ring-line'
      )}
    >
      {video ? (
        <VideoSurface track={video} mirrored={userId === meId && !tracks?.screen} />
      ) : (
        <Avatar user={user ?? { id: userId, username: name, displayName: name, avatarUrl: null }} size={80} speaking={speaking && !vs?.isMuted} />
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[80%] items-center gap-1.5 rounded-md bg-void/75 px-2 py-0.5 text-sm font-medium text-fg">
        <span className="truncate">{name}</span>
        {vs?.isMuted && <MicOff className="h-3.5 w-3.5 text-danger" aria-label="Muted" />}
        {vs?.isDeafened && <HeadphoneOff className="h-3.5 w-3.5 text-danger" aria-label="Deafened" />}
      </span>
      {tracks?.screen && <span className="absolute right-2 top-2 rounded-xs bg-danger px-1.5 text-[10px] font-bold uppercase text-white">Live</span>}
    </div>
  );
}

export { ControlButton } from './ControlButton';
export function CommLinkView({ relay }: { relay: Relay }) {
  const participants = useStore(useShallow((s) => Object.values(s.voice).filter((v) => v.relayId === relay.id).map((v) => v.transmitterId)));
  const session = useVoice(useShallow((s) => ({ relayId: s.relayId, state: s.state, cameraOn: s.cameraOn, screenOn: s.screenOn, encrypted: s.encrypted })));
  const { muted, deafened } = useAudioPrefs();
  const perms = useStore((s) => relayPermissions(s, relay.id));
  const canConnect = can(perms, PERMISSIONS.CONNECT_AUDIO);
  const canBroadcast = can(perms, PERMISSIONS.BROADCAST_HOLO_CAST);
  const [chatOpen, setChatOpen] = useState(false);
  const joined = session.relayId === relay.id && session.state !== 'idle';
  const key = channelKey('relay', relay.id);

  useEffect(() => {
    if (!chatOpen) return;
    setState({ activeChannel: key });
    return () => setState({ activeChannel: null });
  }, [chatOpen, key]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-void">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <MobileNavButton />
        <Volume2 className="h-6 w-6 text-fg-subtle" />
        <h1 className="font-semibold text-fg">{relay.name}</h1>
        {relay.isE2ee && (
          <span className="flex items-center gap-1 text-xs font-medium text-online" data-e2ee={joined && session.encrypted ? 'true' : undefined}>
            <Lock className="h-3.5 w-3.5" /> End-to-end encrypted
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Tooltip content={chatOpen ? 'Hide Chat' : 'Show Chat'} placement="bottom">
            <button
              type="button"
              aria-label="Toggle chat"
              aria-pressed={chatOpen}
              onClick={() => setChatOpen((v) => !v)}
              className={clsx('flex h-8 w-8 items-center justify-center rounded-md', chatOpen ? 'text-fg' : 'text-fg-muted hover:text-fg')}
            >
              <MessageSquare className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {participants.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-raised">
                  <Volume2 className="h-10 w-10 text-fg-muted" />
                </span>
                <h2 className="text-2xl font-bold text-fg">{relay.name}</h2>
                <p className="text-fg-muted">No one is here yet. Transmissions in this {term('commLink')} work without joining.</p>
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, Math.ceil(Math.sqrt(participants.length))))}, minmax(0, 1fr))` }}>
                {participants.map((id) => (
                  <Tile key={id} userId={id} beaconId={relay.beaconId} />
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-center gap-3 pb-6 pt-2">
            {joined ? (
              <>
                <ControlButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={toggleMute}>
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </ControlButton>
                <ControlButton label={deafened ? 'Undeafen' : 'Deafen'} active={deafened} onClick={toggleDeafen}>
                  {deafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
                </ControlButton>
                {canBroadcast && (
                  <>
                    <ControlButton label={session.cameraOn ? 'Turn Off Camera' : 'Turn On Camera'} active={session.cameraOn} onClick={() => void toggleCamera()}>
                      {session.cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                    </ControlButton>
                    <ControlButton label={session.screenOn ? `Stop ${term('holoCast')}` : `Start ${term('holoCast')}`} active={session.screenOn} onClick={() => void toggleScreenShare()}>
                      <MonitorUp className="h-5 w-5" />
                    </ControlButton>
                  </>
                )}
                <SoundboardButton relayId={relay.id} beaconId={relay.beaconId} />
                <ComingSoon label="Activities">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-overlay text-fg">
                    <UsersIcon className="h-5 w-5" />
                  </span>
                </ComingSoon>
                <ControlButton label="Disconnect" danger onClick={() => void leaveVoice()}>
                  <PhoneOff className="h-5 w-5" />
                </ControlButton>
              </>
            ) : (
              <button
                type="button"
                disabled={!canConnect || session.state === 'connecting'}
                onClick={() => void joinVoice(relay.id, relay.beaconId)}
                className="rounded-full bg-online px-6 py-2.5 font-semibold text-void hover:brightness-110 disabled:opacity-50"
              >
                {!canConnect ? 'You cannot join this Comm-Link' : session.relayId === relay.id && session.state === 'connecting' ? 'Connecting…' : `Join ${term('commLink')}`}
              </button>
            )}
          </div>
        </section>

        {chatOpen && (
          <aside aria-label="Comm-Link chat" className="fixed inset-0 z-[700] flex flex-col bg-base md:relative md:inset-auto md:z-auto md:w-[400px] md:shrink-0 md:border-l md:border-line">
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 md:hidden">
              <span className="font-semibold text-fg">#{relay.name} chat</span>
              <button type="button" aria-label="Close chat" onClick={() => setChatOpen(false)} className="text-fg-muted hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            </header>
            <MessageList
              channelKey={key}
              beaconId={relay.beaconId}
              onReply={(messageId) => useUi.setState((u) => ({ replyingTo: { ...u.replyingTo, [key]: { messageId, ping: true } } }))}
              header={<p className="mx-4 mb-2 mt-8 text-sm text-fg-muted">This is the start of the #{relay.name} chat.</p>}
            />
            <Composer channelKey={key} beaconId={relay.beaconId} placeholder={`Transmit to #${relay.name}`} />
            <TypingIndicator channelKey={key} beaconId={relay.beaconId} />
          </aside>
        )}
      </div>
    </div>
  );
}
