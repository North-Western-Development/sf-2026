import { create } from 'zustand';
import { Track, type RemoteTrack } from 'livekit-client';
import { rtcManager } from '../../services/rtc';
import { gateway } from '../../services/gateway';
import { api } from '../../services/api';
import { useAudioPrefs } from '../user/UserPanel';
import { toast } from '../../app/ui';
import { playPing } from '../../data/notifications';

type MediaTracks = { camera?: Track | null; screen?: Track | null };

interface VoiceSession {
  relayId: string | null;
  beaconId: string | null;
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  speaking: string[];
  tracks: Record<string, MediaTracks>;
  cameraOn: boolean;
  screenOn: boolean;
}

export const useVoice = create<VoiceSession>()(() => ({
  relayId: null,
  beaconId: null,
  state: 'idle',
  speaking: [],
  tracks: {},
  cameraOn: false,
  screenOn: false,
}));

const setTrack = (identity: string, kind: keyof MediaTracks, track: Track | null) =>
  useVoice.setState((s) => ({ tracks: { ...s.tracks, [identity]: { ...s.tracks[identity], [kind]: track } } }));

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  rtcManager.onSpeakingChanged((speaking) => useVoice.setState({ speaking }));
  rtcManager.onConnectionStateChanged((state) => {
    const map: Record<string, VoiceSession['state']> = { connected: 'connected', connecting: 'connecting', reconnecting: 'reconnecting', disconnected: 'idle' };
    const next = map[String(state)] ?? 'connecting';
    if (next === 'idle' && useVoice.getState().relayId) void leaveVoice(true);
    else useVoice.setState({ state: next });
  });
  rtcManager.onTrackSubscribed((track: RemoteTrack, pub, participant) => {
    if (track.kind !== Track.Kind.Video) return;
    setTrack(participant.identity, pub.source === Track.Source.ScreenShare ? 'screen' : 'camera', track);
  });
  rtcManager.onTrackUnsubscribed((track: RemoteTrack, pub, participant) => {
    if (track.kind !== Track.Kind.Video) return;
    setTrack(participant.identity, pub.source === Track.Source.ScreenShare ? 'screen' : 'camera', null);
  });
  // Mirror mute/deafen into the room and the gateway voice state.
  useAudioPrefs.subscribe(({ muted, deafened }) => {
    const { relayId } = useVoice.getState();
    if (!relayId) return;
    void rtcManager.setMicrophoneEnabled(!muted);
    rtcManager.setDeafened(deafened);
    gateway.updateVoiceState(relayId, muted, deafened, false);
  });
}

export async function joinVoice(relayId: string, beaconId: string) {
  wire();
  const cur = useVoice.getState();
  if (cur.relayId === relayId && cur.state !== 'idle') return;
  if (cur.relayId) await leaveVoice(true);
  useVoice.setState({ relayId, beaconId, state: 'connecting', tracks: {}, speaking: [], cameraOn: false, screenOn: false });
  try {
    const { muted, deafened } = useAudioPrefs.getState();
    const grant = await api.getCommLinkToken(relayId);
    await rtcManager.connect(grant.livekitUrl, grant.token, { canSpeak: grant.canSpeak, isMuted: muted, isDeafened: deafened });
    gateway.updateVoiceState(relayId, muted, deafened, false);
    useVoice.setState({ state: 'connected' });
    playPing();
  } catch (err) {
    useVoice.setState({ relayId: null, beaconId: null, state: 'idle' });
    toast(`Could not connect to Comm-Link: ${(err as Error).message}`, 'error');
  }
}

export async function leaveVoice(silent = false) {
  const { relayId } = useVoice.getState();
  if (!relayId) return;
  useVoice.setState({ relayId: null, beaconId: null, state: 'idle', tracks: {}, speaking: [], cameraOn: false, screenOn: false });
  gateway.updateVoiceState(null);
  await rtcManager.disconnect().catch(() => {});
  if (!silent) playPing();
}

export async function toggleCamera() {
  const on = !useVoice.getState().cameraOn;
  try {
    const track = await rtcManager.setCameraEnabled(on);
    const me = api.getTransmitter()?.id;
    if (me) setTrack(me, 'camera', on ? track : null);
    useVoice.setState({ cameraOn: on && !!track });
  } catch (err) {
    toast(`Camera unavailable: ${(err as Error).message}`, 'error');
  }
}

export async function toggleScreenShare() {
  const on = !useVoice.getState().screenOn;
  try {
    const track = await rtcManager.setScreenShareEnabled(on);
    const me = api.getTransmitter()?.id;
    if (me) setTrack(me, 'screen', on ? track : null);
    useVoice.setState({ screenOn: on && !!track });
  } catch (err) {
    toast(`Holo-Cast failed: ${(err as Error).message}`, 'error');
  }
}
