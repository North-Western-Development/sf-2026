import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Mic, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react';
import { Tooltip } from '@subspace/ui';
import { toast } from '../../app/ui';
import { uploadToVault } from '../../lib/uploads';
import { sendMessage } from '../../data/actions';
import type { Attachment, ChannelKey } from '../../lib/types';

const BARS = 48;
const MAX_MS = 20 * 60 * 1000;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/** Loudness in BARS steps (0-255), base64: what the player draws. */
async function waveformOf(blob: Blob): Promise<string> {
  try {
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const peaks = Array.from({ length: BARS }, (_, i) => {
      let max = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) max = Math.max(max, Math.abs(data[j]));
      return max;
    });
    const top = Math.max(0.01, ...peaks);
    return btoa(String.fromCharCode(...peaks.map((p) => Math.round((p / top) * 255))));
  } catch {
    return '';
  }
}

/** The composer's microphone (Discord's voice messages): record, then send or throw away. */
export function VoiceRecorderButton({ channelKey }: { channelKey: ChannelKey }) {
  const [recording, setRecording] = useState<{ recorder: MediaRecorder; started: number; chunks: Blob[]; stream: MediaStream } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => {
      const ms = Date.now() - recording.started;
      setElapsed(ms);
      if (ms >= MAX_MS) void finish(true);
    }, 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start(250);
      setElapsed(0);
      setRecording({ recorder, started: Date.now(), chunks, stream });
    } catch {
      toast('Allow microphone access to record a voice message.', 'error');
    }
  };

  const finish = async (send: boolean) => {
    const rec = recording;
    if (!rec) return;
    setRecording(null);
    const stopped = new Promise<void>((r) => rec.recorder.addEventListener('stop', () => r(), { once: true }));
    rec.recorder.stop();
    await stopped;
    rec.stream.getTracks().forEach((t) => t.stop());
    const durationMs = Date.now() - rec.started;
    if (!send || durationMs < 500) return;
    setBusy(true);
    try {
      const type = (rec.recorder.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(rec.chunks, { type });
      const saved = await uploadToVault(new File([blob], `voice-message.${type === 'audio/ogg' ? 'ogg' : 'webm'}`, { type }));
      if (!saved) return;
      await sendMessage(channelKey, '', { attachmentIds: [saved.id], voiceMessage: { durationMs, waveform: await waveformOf(blob) } });
    } catch (err) {
      toast(`Could not send the voice message: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (recording) {
    return (
      <div role="group" aria-label="Recording a voice message" className="absolute inset-x-4 bottom-6 z-10 flex h-11 items-center gap-3 rounded-lg bg-raised px-3 ring-1 ring-danger">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
        <span className="text-sm tabular-nums text-fg">{clock(elapsed)}</span>
        <span className="flex-1 text-sm text-fg-muted">Recording a voice message…</span>
        <Tooltip content="Discard">
          <button type="button" aria-label="Discard voice message" onClick={() => void finish(false)} className="text-fg-muted hover:text-danger">
            <Trash2 className="h-5 w-5" />
          </button>
        </Tooltip>
        <Tooltip content="Send">
          <button type="button" aria-label="Send voice message" onClick={() => void finish(true)} className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-on-brand hover:brightness-110">
            <SendHorizontal className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
    );
  }
  return (
    <Tooltip content="Record a Voice Message">
      <button type="button" aria-label="Record a voice message" disabled={busy} onClick={() => void start()} className="mt-2.5 flex h-6 w-6 items-center justify-center text-fg-muted hover:text-fg disabled:opacity-40">
        <Mic className="h-5 w-5" />
      </button>
    </Tooltip>
  );
}

/** A voice message: play or pause, a waveform that fills as it plays, and the time. */
export function VoiceMessagePlayer({ attachment }: { attachment: Attachment }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const duration = attachment.durationMs ?? 0;
  const bars = useMemo(() => {
    try {
      const raw = atob(attachment.waveform ?? '');
      if (raw.length) return Array.from(raw, (c) => c.charCodeAt(0) / 255);
    } catch {
      /* no waveform */
    }
    return Array.from({ length: BARS }, () => 0.35);
  }, [attachment.waveform]);
  const progress = duration ? Math.min(1, at / duration) : 0;
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  return (
    <div aria-label="Voice message" role="group" className="mt-1 flex w-full max-w-[360px] items-center gap-3 rounded-full bg-raised py-1.5 pl-1.5 pr-4">
      <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand hover:brightness-110">
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
        {bars.map((v, i) => (
          <span key={i} className={clsx('w-[3px] shrink-0 rounded-full', i / bars.length < progress ? 'bg-brand-sky' : 'bg-fg-subtle')} style={{ height: `${Math.max(12, v * 100)}%` }} />
        ))}
      </div>
      <span className="text-xs tabular-nums text-fg-muted">{clock(playing || at ? at : duration)}</span>
      <audio
        ref={audio}
        src={attachment.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime * 1000)}
      />
    </div>
  );
}
