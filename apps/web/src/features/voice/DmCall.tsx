import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { BellRing, Lock, Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Tooltip } from '@subspace/ui';
import { useStore, type SubspaceState } from '../../data/store';
import { parseChannelKey, type ChannelKey, type UserRef } from '../../lib/types';
import { term } from '../../lib/strings';
import { HeaderButton } from '../chat/ChannelView';
import { Avatar } from '../common/Avatar';
import { useAudioPrefs, toggleMute, toggleDeafen } from './audioPrefs';
import { Tile } from './CommLinkView';
import { ControlButton } from './ControlButton';
import { useVoice, joinCall, leaveVoice, declineCall, ringAgain, toggleCamera, toggleScreenShare } from './session';

/** How long an unanswered call keeps ringing someone. */
const RING_MS = 60_000;

const inCall = (s: SubspaceState, key: ChannelKey) =>
  Object.values(s.voice)
    .filter((v) => v.callKey === key)
    .map((v) => v.transmitterId);

function conversationName(s: SubspaceState, key: ChannelKey): string {
  const { type, id } = parseChannelKey(key);
  if (type === 'link') {
    const u = s.links[id]?.recipient;
    return u ? u.displayName || u.username : 'Direct Link';
  }
  const mesh = s.meshes[id];
  return mesh?.name || mesh?.members.map((m) => m.displayName || m.username).join(', ') || 'Subspace Mesh';
}

/** "Start Voice Call" / "Start Video Call" in a DM header. */
export function CallButtons({ channelKey: key }: { channelKey: ChannelKey }) {
  const mine = useVoice((s) => s.callKey === key && s.state !== 'idle');
  const busy = useStore((s) => inCall(s, key).length > 0);
  const label = busy && !mine ? 'Join Call' : 'Start Voice Call';
  return (
    <>
      <HeaderButton label={label} onClick={() => void joinCall(key)}>
        <Phone className="h-5 w-5" />
      </HeaderButton>
      <HeaderButton label={busy && !mine ? 'Join Video Call' : 'Start Video Call'} onClick={() => void joinCall(key, { video: true })}>
        <Video className="h-5 w-5" />
      </HeaderButton>
    </>
  );
}

/** The call area across the top of a DM while a call is running (Discord's DM call view). */
export function CallPanel({ channelKey: key }: { channelKey: ChannelKey }) {
  const participants = useStore(useShallow((s) => inCall(s, key)));
  const call = useStore((s) => s.calls[key]);
  const ringingUsers = useStore(
    useShallow((s) => (s.calls[key]?.ringing ?? []).filter((id) => !inCall(s, key).includes(id)).map((id) => s.users[id]).filter(Boolean) as UserRef[])
  );
  const session = useVoice(useShallow((s) => ({ mine: s.callKey === key, state: s.state, cameraOn: s.cameraOn, screenOn: s.screenOn, encrypted: s.encrypted })));
  const encryptedLink = useStore((s) => (key.startsWith('link:') && !!s.links[key.slice(5)]?.encryptedAt) || (key.startsWith('mesh:') && !!s.meshes[key.slice(5)]?.encryptedAt));
  const { muted, deafened } = useAudioPrefs();
  const joined = session.mine && session.state !== 'idle';
  if (!participants.length && !call && !joined) return null;

  return (
    <section aria-label="Call" data-e2ee={joined && session.encrypted ? 'true' : undefined} className="relative flex shrink-0 flex-col bg-void px-4 pb-4 pt-6">
      {encryptedLink && (
        <span className="absolute left-4 top-3 flex items-center gap-1 text-xs font-medium text-online">
          <Lock className="h-3.5 w-3.5" /> End-to-end encrypted
        </span>
      )}
      <div className="flex min-h-[180px] flex-wrap items-center justify-center gap-3">
        {participants.map((id) => (
          <div key={id} className="w-[min(360px,40%)]">
            <Tile userId={id} />
          </div>
        ))}
        {ringingUsers.map((u) => (
          <div key={u.id} role="group" aria-label={`Ringing ${u.displayName || u.username}`} className="flex flex-col items-center gap-2 opacity-70">
            <Avatar user={u} size={80} className="animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Ringing…</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        {joined ? (
          <>
            <ControlButton label={session.cameraOn ? 'Turn Off Camera' : 'Turn On Camera'} active={session.cameraOn} onClick={() => void toggleCamera()}>
              {session.cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </ControlButton>
            <ControlButton label={session.screenOn ? `Stop ${term('holoCast')}` : `Start ${term('holoCast')}`} active={session.screenOn} onClick={() => void toggleScreenShare()}>
              <MonitorUp className="h-5 w-5" />
            </ControlButton>
            <ControlButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={toggleMute}>
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </ControlButton>
            <ControlButton label={deafened ? 'Undeafen' : 'Deafen'} active={deafened} onClick={toggleDeafen}>
              {deafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
            </ControlButton>
            {participants.length === 1 && (
              <ControlButton label="Ring Again" onClick={() => void ringAgain(key)}>
                <BellRing className="h-5 w-5" />
              </ControlButton>
            )}
            <ControlButton label="Leave Call" danger onClick={() => void leaveVoice()}>
              <PhoneOff className="h-5 w-5" />
            </ControlButton>
          </>
        ) : (
          <button
            type="button"
            disabled={session.mine && session.state === 'connecting'}
            onClick={() => void joinCall(key)}
            className="rounded-full bg-online px-6 py-2.5 font-semibold text-void hover:brightness-110 disabled:opacity-50"
          >
            {session.mine && session.state === 'connecting' ? 'Connecting…' : 'Join Call'}
          </button>
        )}
      </div>
    </section>
  );
}

let ringCtx: AudioContext | null = null;
/** A soft two-tone ring, repeated while a call is waiting. */
function ringOnce() {
  try {
    ringCtx ??= new AudioContext();
    const now = ringCtx.currentTime;
    [0, 0.45].forEach((offset) =>
      [523, 659].forEach((freq) => {
        const osc = ringCtx!.createOscillator();
        const gain = ringCtx!.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.08, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
        osc.connect(gain).connect(ringCtx!.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.4);
      })
    );
  } catch {
    /* audio unavailable */
  }
}

/** The incoming-call prompt, shown anywhere in the app while someone is ringing you. */
export function IncomingCall() {
  const navigate = useNavigate();
  const meId = useStore((s) => s.me?.id);
  const myCall = useVoice((s) => s.callKey);
  const [now, setNow] = useState(() => Date.now());
  const incoming = useStore(
    useShallow((s) =>
      (Object.entries(s.calls) as Array<[ChannelKey, (typeof s.calls)[ChannelKey]]>)
        .filter(([key, c]) => !!meId && c.ringing.includes(meId) && key !== myCall && inCall(s, key).length > 0)
        .map(([key]) => key)
    )
  );
  const key = incoming.find((k) => now - Date.parse(useStore.getState().calls[k]?.startedAt ?? '') < RING_MS) ?? null;
  const call = useStore((s) => (key ? s.calls[key] : undefined));
  const caller = useStore((s) => (call ? s.users[call.startedBy] : undefined));
  const name = useStore((s) => (key ? conversationName(s, key) : ''));

  useEffect(() => {
    if (!incoming.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [incoming.length]);

  useEffect(() => {
    if (!key) return;
    ringOnce();
    const t = setInterval(ringOnce, 2500);
    if (document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(`Incoming call from ${caller?.displayName || caller?.username || name}`, { tag: `call-${key}` });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key || !call) return null;
  const go = () => navigate(`/channels/@me/${parseChannelKey(key).id}`);
  const accept = (video: boolean) => {
    go();
    void joinCall(key, { video });
  };

  return (
    <div
      role="alertdialog"
      aria-label={`Incoming call from ${caller?.displayName || caller?.username || name}`}
      className="fixed left-1/2 top-16 z-[1300] flex w-[240px] -translate-x-1/2 flex-col items-center rounded-2xl bg-overlay px-4 pb-5 pt-6 shadow-modal"
    >
      {caller && <Avatar user={caller} size={80} className="ring-4 ring-online/40 animate-pulse rounded-full" />}
      <p className="mt-3 max-w-full truncate text-lg font-bold text-fg">{name}</p>
      <p className="text-sm text-fg-muted">Incoming call…</p>
      <div className="mt-5 flex items-center gap-4">
        <CallAction label="Decline" className="bg-danger" onClick={() => void declineCall(key)}>
          <PhoneOff className="h-5 w-5" />
        </CallAction>
        <CallAction label="Accept with Video" className="bg-overlay ring-1 ring-line-strong" onClick={() => accept(true)}>
          <Video className="h-5 w-5" />
        </CallAction>
        <CallAction label="Accept" className="bg-online text-void" onClick={() => accept(false)}>
          <Phone className="h-5 w-5" />
        </CallAction>
      </div>
    </div>
  );
}

function CallAction({ label, className, onClick, children }: { label: string; className: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button type="button" aria-label={label} onClick={onClick} className={clsx('flex h-12 w-12 items-center justify-center rounded-full text-white hover:brightness-110', className)}>
        {children}
      </button>
    </Tooltip>
  );
}
