import { create } from 'zustand';
import { Track, type RemoteTrack } from 'livekit-client';
import { rtcManager } from '../../services/rtc';
import { gateway } from '../../services/gateway';
import { api } from '../../services/api';
import { http } from '../../lib/http';
import { parseChannelKey, type ChannelKey } from '../../lib/types';
import { getState } from '../../data/store';
import { useAudioPrefs } from '../user/UserPanel';
import { toast } from '../../app/ui';
import { playPing } from '../../data/notifications';

type MediaTracks = { camera?: Track | null; screen?: Track | null };

interface VoiceSession {
  /** Comm-Link relay this client is in. */
  relayId: string | null;
  beaconId: string | null;
  /** Direct-link or mesh call this client is in. */
  callKey: ChannelKey | null;
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  speaking: string[];
  tracks: Record<string, MediaTracks>;
  cameraOn: boolean;
  screenOn: boolean;
}

export const useVoice = create<VoiceSession>()(() => ({
  relayId: null,
  beaconId: null,
  callKey: null,
  state: 'idle',
  speaking: [],
  tracks: {},
  cameraOn: false,
  screenOn: false,
}));

const idle = { relayId: null, beaconId: null, callKey: null, state: 'idle' as const, tracks: {}, speaking: [], cameraOn: false, screenOn: false };

/** The room to report to the gateway: a relay id, a call, or nothing. */
function gatewayRoom(): Parameters<typeof gateway.updateVoiceState>[0] {
  const { relayId, callKey } = useVoice.getState();
  if (relayId) return relayId;
  if (callKey) {
    const { type, id } = parseChannelKey(callKey);
    return { callType: type as 'link' | 'mesh', callId: id };
  }
  return null;
}

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
    const s = useVoice.getState();
    if (next === 'idle' && (s.relayId || s.callKey)) void leaveVoice(true);
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
    const room = gatewayRoom();
    if (!room) return;
    void rtcManager.setMicrophoneEnabled(!muted);
    rtcManager.setDeafened(deafened);
    gateway.updateVoiceState(room, muted, deafened, false);
  });
  // A dropped gateway forgets voice states; tell the new connection where we are.
  gateway.onStatus((status) => {
    const room = gatewayRoom();
    if (status === 'ready' && room && useVoice.getState().state !== 'idle') {
      const { muted, deafened } = useAudioPrefs.getState();
      gateway.updateVoiceState(room, muted, deafened, false);
    }
  });
}

export async function joinVoice(relayId: string, beaconId: string) {
  wire();
  const cur = useVoice.getState();
  if (cur.relayId === relayId && cur.state !== 'idle') return;
  if (cur.relayId || cur.callKey) await leaveVoice(true);
  useVoice.setState({ ...idle, relayId, beaconId, state: 'connecting' });
  try {
    const { muted, deafened } = useAudioPrefs.getState();
    const grant = await api.getCommLinkToken(relayId);
    await rtcManager.connect(grant.livekitUrl, grant.token, { canSpeak: grant.canSpeak, isMuted: muted, isDeafened: deafened });
    gateway.updateVoiceState(relayId, muted, deafened, false);
    useVoice.setState({ state: 'connected' });
    playPing();
  } catch (err) {
    useVoice.setState(idle);
    toast(`Could not connect to Comm-Link: ${(err as Error).message}`, 'error');
  }
}

/** Whether anyone is connected to a direct-link or mesh call. */
export const callParticipants = (key: ChannelKey) =>
  Object.values(getState().voice)
    .filter((v) => v.callKey === key)
    .map((v) => v.transmitterId);

/**
 * Join (or start) the call in a direct link or mesh. Starting one rings everyone else.
 * `video` turns the camera on once connected.
 */
export async function joinCall(key: ChannelKey, { video = false } = {}) {
  wire();
  const cur = useVoice.getState();
  if (cur.callKey === key && cur.state !== 'idle') return;
  if (cur.relayId || cur.callKey) await leaveVoice(true);
  const { type, id } = parseChannelKey(key);
  useVoice.setState({ ...idle, callKey: key, state: 'connecting' });
  try {
    if (!getState().calls[key]) await http.post(`/calls/${type}/${id}/ring`);
    const grant = await http.post<{ token: string; livekitUrl: string | null }>(`/calls/${type}/${id}/token`);
    const sameOrigin = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    const { muted, deafened } = useAudioPrefs.getState();
    await rtcManager.connect(grant.livekitUrl || sameOrigin, grant.token, { canSpeak: true, isMuted: muted, isDeafened: deafened });
    gateway.updateVoiceState({ callType: type as 'link' | 'mesh', callId: id }, muted, deafened, false);
    useVoice.setState({ state: 'connected' });
    playPing();
    if (video) await toggleCamera();
  } catch (err) {
    useVoice.setState(idle);
    toast(`Could not connect the call: ${(err as Error).message}`, 'error');
  }
}

/** Stop ringing for an incoming call without joining it. */
export function declineCall(key: ChannelKey) {
  const { type, id } = parseChannelKey(key);
  return http.post(`/calls/${type}/${id}/decline`).catch(() => {});
}

/** Ring everyone in the conversation who is not in the call yet. */
export function ringAgain(key: ChannelKey) {
  const { type, id } = parseChannelKey(key);
  return http.post(`/calls/${type}/${id}/ring`).catch(() => toast('Could not ring them', 'error'));
}

export async function leaveVoice(silent = false) {
  const { relayId, callKey } = useVoice.getState();
  if (!relayId && !callKey) return;
  useVoice.setState(idle);
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
