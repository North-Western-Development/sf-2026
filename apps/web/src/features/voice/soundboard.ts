import { create } from 'zustand';
import { http } from '../../lib/http';
import { toast } from '../../app/ui';
import { useAudioPrefs } from './audioPrefs';
import { useVoice } from './session';

export interface Sound {
  id: string;
  beaconId: string;
  name: string;
  emoji: string | null;
  url: string;
  volume: number;
}

/** Built-in sounds every comm-link has (Discord's default sounds), made with WebAudio. */
export const DEFAULT_SOUNDS: Array<{ id: string; name: string; emoji: string }> = [
  { id: 'ping', name: 'Ping', emoji: '🔔' },
  { id: 'chime', name: 'Chime', emoji: '🎐' },
  { id: 'drum', name: 'Ba-dum-tss', emoji: '🥁' },
  { id: 'laser', name: 'Laser', emoji: '⚡' },
  { id: 'cheer', name: 'Cheer', emoji: '🎉' },
  { id: 'boing', name: 'Boing', emoji: '🦘' },
];

let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

function tone(type: OscillatorType, from: number, to: number, start: number, length: number, gain = 0.25) {
  const a = audio();
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, a.currentTime + start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), a.currentTime + start + length);
  g.gain.setValueAtTime(gain, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + start + length);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + length + 0.05);
}

function noise(start: number, length: number, gain = 0.3, filter = 4000) {
  const a = audio();
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filter;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + start + length);
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + start);
}

const SYNTH: Record<string, () => void> = {
  ping: () => tone('sine', 1320, 1280, 0, 0.4),
  chime: () => [880, 1108, 1320].forEach((f, i) => tone('triangle', f, f, i * 0.12, 0.5, 0.2)),
  drum: () => {
    tone('sine', 160, 50, 0, 0.25, 0.5);
    tone('sine', 220, 70, 0.22, 0.25, 0.45);
    noise(0.45, 0.6, 0.25, 7000);
  },
  laser: () => tone('sawtooth', 1800, 120, 0, 0.35, 0.15),
  cheer: () => {
    for (let i = 0; i < 8; i++) noise(i * 0.07, 0.5, 0.12, 1500 + Math.random() * 2500);
  },
  boing: () => {
    tone('sine', 180, 520, 0, 0.12, 0.35);
    tone('sine', 520, 140, 0.12, 0.45, 0.35);
  },
};

/** Plays a sound on this device (what everyone in the comm-link does when one is played). */
export function playLocal(sound: { url?: string | null; volume?: number; defaultSound?: string | null }) {
  if (useAudioPrefs.getState().deafened) return;
  if (sound.defaultSound) return SYNTH[sound.defaultSound]?.();
  if (!sound.url) return;
  const el = new Audio(sound.url);
  el.volume = Math.max(0, Math.min(1, (sound.volume ?? 100) / 100));
  void el.play().catch(() => undefined);
}

/** Gateway SOUNDBOARD_PLAY: play it if we are in that comm-link. */
export function onSoundboardPlay(d: { relayId: string; sound: { url: string | null; volume: number; defaultSound: string | null } }) {
  if (useVoice.getState().relayId === d.relayId) playLocal(d.sound);
}

/** Plays a sound to the comm-link you are in. */
export async function sendSound(relayId: string, which: { soundId: string } | { defaultSound: string }) {
  try {
    await http.post(`/relays/${relayId}/soundboard`, which);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

/** Each beacon's sounds, loaded when the soundboard first opens. */
export const useSounds = create<Record<string, Sound[] | undefined>>()(() => ({}));
export async function loadSounds(beaconId: string, force = false) {
  if (!force && useSounds.getState()[beaconId]) return;
  const r = await http.get<{ sounds: Sound[] }>(`/beacons/${beaconId}/sounds`).catch(() => ({ sounds: [] as Sound[] }));
  useSounds.setState({ [beaconId]: r.sounds });
}
