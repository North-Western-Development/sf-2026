import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A fake microphone that talks. Chrome's default fake device only beeps (a short blip every
 * half second), which LiveKit rightly does not count as speech: speaking indicators then light
 * up for a moment after joining and never again. These four seconds of a steady, gently
 * wavering 220 Hz tone, looped by Chrome, read as someone talking the whole time.
 */
function fakeVoiceFile(): string {
  const file = path.join(os.tmpdir(), 'subspace-fake-voice-v1.wav');
  if (fs.existsSync(file)) return file;
  const rate = 48_000;
  const samples = rate * 4;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); // PCM header size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const v = 0.4 * Math.sin(2 * Math.PI * 220 * t) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 3 * t));
    wav.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  // Workers start together: write aside, then move into place in one step.
  const tmp = `${file}.${process.pid}`;
  fs.writeFileSync(tmp, wav);
  fs.renameSync(tmp, file);
  return file;
}

/** Chromium flags for specs that use the microphone (and camera): granted, fake, and talking. */
export const MEDIA_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fakeVoiceFile()}`];
