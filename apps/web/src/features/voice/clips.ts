import { create } from 'zustand';
import { rtcManager } from '../../services/rtc';
import { toast } from '../../app/ui';
import { useVoice } from './session';
import { gateway } from '../../services/gateway';
import { getState, useStore } from '../../data/store';
import { resolveName } from '../../lib/normalize';

/**
 * Clips (Discord's): while you Holo-Cast with clips on, the last stretch of your stream and the
 * room's audio is kept on this device, and Ctrl + Shift + C (or the Clip button) saves it.
 * Nothing is uploaded; clips live in this browser's IndexedDB until you delete them.
 *
 * A WebM recording cannot be cut from its middle without re-encoding, so two recorders run
 * staggered by one clip length and restart every two lengths: one of them always holds between
 * one and two lengths, and the clip remembers where its last `length` seconds begin.
 */

export const CLIP_LENGTHS = [30, 60, 120] as const;

interface ClipPrefs {
  enabled: boolean;
  /** Seconds kept. */
  length: (typeof CLIP_LENGTHS)[number];
}

const PREFS_KEY = 'subspace_clip_prefs';
const readPrefs = (): ClipPrefs => {
  try {
    return { enabled: false, length: 30, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { enabled: false, length: 30 };
  }
};

export const useClipPrefs = create<ClipPrefs>()(readPrefs);
export function setClipPrefs(p: Partial<ClipPrefs>) {
  useClipPrefs.setState(p);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(useClipPrefs.getState()));
  } catch {
    /* ignore */
  }
  syncRecording();
}

export interface Clip {
  id: string;
  createdAt: number;
  title: string;
  /** Length of the recording, and where the kept part starts (ms). */
  durationMs: number;
  trimStartMs: number;
  mime: string;
  blob: Blob;
}

// ---- Storage ---------------------------------------------------------------

const DB = 'subspace-clips';
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('clips', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction('clips', mode).objectStore('clips'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const listClips = () => tx<Clip[]>('readonly', (s) => s.getAll()).then((all) => all.sort((a, b) => b.createdAt - a.createdAt));
export const deleteClip = (id: string) => tx('readwrite', (s) => s.delete(id));
const putClip = (c: Clip) => tx('readwrite', (s) => s.put(c));

/** How many voices the clip mix holds right now. */
export const useClipMix = create<{ voices: number }>()(() => ({ voices: 0 }));

/** Bumps when clips are added, so an open gallery reloads. */
export const useClipsVersion = create<{ v: number }>()(() => ({ v: 0 }));

// ---- Recording -------------------------------------------------------------

interface Rolling {
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
}

let slots: [Rolling | null, Rolling | null] = [null, null];
let timers: number[] = [];
let mixer: { ctx: AudioContext; dest: MediaStreamAudioDestinationNode; sources: Map<string, MediaStreamAudioSourceNode> } | null = null;
let sourceStream: MediaStream | null = null;

const mimeType = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

/**
 * Bring the mix in line with the room: everyone who is in it now, including whoever joined after
 * the Holo-Cast started, and nobody who has left. A recorder takes one audio track, so the mix is
 * one track whose sources change underneath it.
 */
function syncMix() {
  if (!mixer) return;
  const live = new Map(rtcManager.getClipSources().audio.map((t) => [t.id, t]));
  for (const [id, node] of mixer.sources) {
    if (!live.has(id)) {
      node.disconnect();
      mixer.sources.delete(id);
    }
  }
  for (const [id, t] of live) {
    if (mixer.sources.has(id) || t.readyState === 'ended') continue;
    const node = mixer.ctx.createMediaStreamSource(new MediaStream([t]));
    node.connect(mixer.dest);
    mixer.sources.set(id, node);
  }
  if (useClipMix.getState().voices !== mixer.sources.size) useClipMix.setState({ voices: mixer.sources.size });
}

/** The stream plus the room's audio, mixed. */
function buildStream(): MediaStream | null {
  const { video } = rtcManager.getClipSources();
  if (!video) return null;
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  mixer = { ctx, dest, sources: new Map() };
  syncMix();
  timers.push(window.setInterval(syncMix, 1000));
  return new MediaStream([video, ...dest.stream.getAudioTracks()]);
}

function startSlot(i: 0 | 1) {
  if (!sourceStream) return;
  const old = slots[i];
  if (old && old.recorder.state !== 'inactive') old.recorder.stop();
  const recorder = new MediaRecorder(sourceStream, { mimeType: mimeType() || undefined, videoBitsPerSecond: 2_500_000 });
  const slot: Rolling = { recorder, chunks: [], startedAt: Date.now() };
  recorder.ondataavailable = (e) => e.data.size && slot.chunks.push(e.data);
  recorder.start(1000);
  slots[i] = slot;
}

function startRecording() {
  if (sourceStream) return;
  sourceStream = buildStream();
  if (!sourceStream) return;
  const period = useClipPrefs.getState().length * 2 * 1000;
  startSlot(0);
  timers.push(
    window.setTimeout(() => {
      startSlot(1);
      timers.push(window.setInterval(() => startSlot(1), period));
    }, period / 2),
    window.setInterval(() => startSlot(0), period)
  );
}

function stopRecording() {
  timers.forEach((t) => clearInterval(t));
  timers = [];
  slots.forEach((s) => s && s.recorder.state !== 'inactive' && s.recorder.stop());
  slots = [null, null];
  void mixer?.ctx.close().catch(() => {});
  mixer = null;
  sourceStream = null;
  gateway.setClipping(false);
}

/** Record exactly while clips are on and I am Holo-Casting. */
function syncRecording() {
  const want = useClipPrefs.getState().enabled && useVoice.getState().screenOn && typeof MediaRecorder !== 'undefined';
  if (want && !sourceStream) {
    startRecording();
    gateway.setClipping(!!sourceStream);
  }
  else if (!want && sourceStream) stopRecording();
}
useVoice.subscribe((v, prev) => {
  if (v.screenOn !== prev.screenOn) {
    stopRecording();
    syncRecording();
  }
});

export const canClip = () => !!sourceStream;

// ---- Warning the room ------------------------------------------------------

/** People I was told about, per room, so the warning shows once each time they start. */
const warned = new Set<string>();
useStore.subscribe((s) => {
  const v = useVoice.getState();
  const me = v.relayId;
  if (!me) return warned.clear();
  const meId = s.me?.id;
  const clipping = Object.values(s.voice).filter((x) => x.relayId === me && x.isClipping && x.transmitterId !== meId);
  const now = new Set(clipping.map((x) => `${me}:${x.transmitterId}`));
  for (const k of warned) if (!now.has(k)) warned.delete(k);
  for (const x of clipping) {
    const k = `${me}:${x.transmitterId}`;
    if (warned.has(k)) continue;
    warned.add(k);
    const st = getState();
    const name = resolveName(st.users[x.transmitterId] ?? { username: x.username }, x.beaconId ? st.members[x.beaconId]?.[x.transmitterId] : undefined);
    toast(`${name} has Clips on. What you say here can be saved in their clips.`, 'warning');
  }
});

/** Save the last clip-length of the stream. */
export async function saveClip(): Promise<Clip | null> {
  if (!sourceStream) {
    toast(useClipPrefs.getState().enabled ? 'Start a Holo-Cast to clip it.' : 'Turn on Clips in Voice & Video settings first.', 'error');
    return null;
  }
  const lengthMs = useClipPrefs.getState().length * 1000;
  // The recording that has run longest holds the most; prefer it.
  const slot = slots.filter((s): s is Rolling => !!s).sort((a, b) => a.startedAt - b.startedAt)[0];
  if (!slot) return null;
  const stopped = new Promise<void>((resolve) => slot.recorder.addEventListener('stop', () => resolve(), { once: true }));
  const endedAt = Date.now();
  slot.recorder.stop();
  await stopped;
  const blob = new Blob(slot.chunks, { type: slot.recorder.mimeType || 'video/webm' });
  // Keep this slot recording for the next clip.
  const i = slots.indexOf(slot) as 0 | 1;
  slots[i] = null;
  if (sourceStream) startSlot(i);

  const durationMs = endedAt - slot.startedAt;
  const clip: Clip = {
    id: `${endedAt}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: endedAt,
    title: `Clip ${new Date(endedAt).toLocaleString()}`,
    durationMs,
    trimStartMs: Math.max(0, durationMs - lengthMs),
    mime: blob.type,
    blob,
  };
  await putClip(clip);
  useClipsVersion.setState((s) => ({ v: s.v + 1 }));
  toast('Clip saved. Find it under Clips in your profile menu.', 'success');
  return clip;
}

// Ctrl + Shift + C anywhere, like Discord's default clip keybind.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
    if (!sourceStream && !useVoice.getState().screenOn) return;
    e.preventDefault();
    void saveClip();
  }
});
