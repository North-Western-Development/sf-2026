import { create } from 'zustand';
import { rtcManager } from '../../services/rtc';
import { toast } from '../../app/ui';
import { useVoice } from './session';

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
let mixer: { ctx: AudioContext; stream: MediaStream } | null = null;
let sourceStream: MediaStream | null = null;

const mimeType = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

/** The stream plus the room's audio, mixed: whoever is in the comm-link when the Holo-Cast starts. */
function buildStream(): MediaStream | null {
  const { video, audio } = rtcManager.getClipSources();
  if (!video) return null;
  const tracks: MediaStreamTrack[] = [video];
  if (audio.length) {
    // One mixed audio track: a recorder takes only one.
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    audio.forEach((t) => ctx.createMediaStreamSource(new MediaStream([t])).connect(dest));
    mixer = { ctx, stream: dest.stream };
    tracks.push(...dest.stream.getAudioTracks());
  }
  return new MediaStream(tracks);
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
}

/** Record exactly while clips are on and I am Holo-Casting. */
function syncRecording() {
  const want = useClipPrefs.getState().enabled && useVoice.getState().screenOn && typeof MediaRecorder !== 'undefined';
  if (want && !sourceStream) startRecording();
  else if (!want && sourceStream) stopRecording();
}
useVoice.subscribe((v, prev) => {
  if (v.screenOn !== prev.screenOn) {
    stopRecording();
    syncRecording();
  }
});

export const canClip = () => !!sourceStream;

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
