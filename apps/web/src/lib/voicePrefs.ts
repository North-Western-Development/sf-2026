import { create } from 'zustand';

/** Input sensitivity (Voice & Video): when the microphone counts as speaking. */
export interface VoicePrefs {
  /** Discord's "Automatically determine input sensitivity". */
  autoSensitivity: boolean;
  /** Manual threshold in dBFS (-100 silent … 0 loudest). */
  thresholdDb: number;
  /** Voice Activity (the gate above) or Push to Talk (only while the key is held). */
  inputMode: 'voice' | 'ptt';
  /** KeyboardEvent.code for push-to-talk and for Priority Speaker (null: not set). */
  pttKey: string | null;
  priorityKey: string | null;
}

const KEY = 'subspace_voice_prefs';
const defaults: VoicePrefs = { autoSensitivity: true, thresholdDb: -50, inputMode: 'voice', pttKey: 'Backquote', priorityKey: null };
const read = (): VoicePrefs => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
};
export const useVoicePrefs = create<VoicePrefs>()(read);
export function setVoicePrefs(patch: Partial<VoicePrefs>) {
  useVoicePrefs.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(useVoicePrefs.getState()));
  } catch {
    /* storage unavailable */
  }
}

/** The chosen input device (Voice & Video › Input Device), if any. */
export function inputDeviceId(): string | undefined {
  try {
    const id = JSON.parse(localStorage.getItem('subspace_av_devices') || '{}').audioInput;
    return id && id !== 'default' ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Measures a microphone's loudness about 20 times a second and reports dBFS. In auto mode
 * the threshold follows the background noise (a slow floor estimate, plus a margin).
 */
export function watchLevel(track: MediaStreamTrack, onLevel: (db: number, threshold: number) => void): () => void {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let floor = -60;
  // Browsers start an AudioContext suspended until the page has had a gesture; while it is,
  // nothing is measured (and the gate stays open), rather than reading silence.
  void ctx.resume().catch(() => undefined);
  const timer = window.setInterval(() => {
    if (ctx.state !== 'running') return void ctx.resume().catch(() => undefined);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const db = Math.max(-100, 20 * Math.log10(Math.sqrt(sum / data.length) || 1e-5));
    // The floor falls fast to quiet moments and rises slowly with steady noise.
    floor = db < floor ? db * 0.3 + floor * 0.7 : floor * 0.995 + db * 0.005;
    const prefs = useVoicePrefs.getState();
    // Auto never asks for more than -35 dB, so steady loud input still counts as speech.
    onLevel(db, prefs.autoSensitivity ? Math.min(-35, Math.max(-70, floor + 14)) : prefs.thresholdDb);
  }, 50);
  return () => {
    window.clearInterval(timer);
    source.disconnect();
    void ctx.close();
  };
}

/**
 * Push-to-talk state: whether the key is held, and whether this comm-link insists on it (no Use
 * Voice Activity there). Priority Speaker's key transmits too.
 */
export const usePushToTalk = create<{ held: boolean; priorityHeld: boolean; forced: boolean }>()(() => ({ held: false, priorityHeld: false, forced: false }));

/** Whether the microphone may send right now, under push-to-talk; null when voice activity decides. */
export function pushToTalkOpen(): boolean | null {
  const { held, priorityHeld, forced } = usePushToTalk.getState();
  if (useVoicePrefs.getState().inputMode !== 'ptt' && !forced && !priorityHeld) return null;
  return held || priorityHeld;
}

/** Keys typed into a text field are typing, not talking (unless they cannot type, like F-keys). */
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && e.key.length === 1;
};
let releaseTimer = 0;
window.addEventListener('keydown', (e) => {
  if (e.repeat || typing(e)) return;
  const { pttKey, priorityKey } = useVoicePrefs.getState();
  if (e.code === pttKey) {
    window.clearTimeout(releaseTimer);
    usePushToTalk.setState({ held: true });
  }
  if (e.code === priorityKey) usePushToTalk.setState({ priorityHeld: true });
});
window.addEventListener('keyup', (e) => {
  const { pttKey, priorityKey } = useVoicePrefs.getState();
  // A short hold after release, so the last word is not cut off.
  if (e.code === pttKey) releaseTimer = window.setTimeout(() => usePushToTalk.setState({ held: false }), 200);
  if (e.code === priorityKey) usePushToTalk.setState({ priorityHeld: false });
});
window.addEventListener('blur', () => usePushToTalk.setState({ held: false, priorityHeld: false }));

/**
 * The voice gate: below the threshold for a moment, the microphone sends silence; under
 * push-to-talk, it sends only while the key is held. `isMuted` is the user's own mute, which
 * disables the same track and always wins.
 */
export function gateMicrophone(track: MediaStreamTrack, isMuted: () => boolean): () => void {
  let quietSince = 0;
  // Measure a copy: the gate silences the track itself, and must still hear when to reopen.
  const probe = track.clone();
  probe.enabled = true;
  const stop = watchLevel(probe, (db, threshold) => {
    const now = Date.now();
    if (isMuted()) return;
    const ptt = pushToTalkOpen();
    if (ptt !== null) {
      track.enabled = ptt;
      return;
    }
    if (db >= threshold) {
      quietSince = 0;
      track.enabled = true;
    } else {
      quietSince ||= now;
      // Hold open briefly so word endings are not clipped.
      if (now - quietSince > 350) track.enabled = false;
    }
  });
  return () => {
    stop();
    probe.stop();
    if (!isMuted()) track.enabled = true;
  };
}
