import { useEffect, useRef, useState } from 'react';
import { Button } from '@subspace/ui';
import { clsx } from 'clsx';
import { inputDeviceId, setVoicePrefs, useVoicePrefs, watchLevel } from '../../../lib/voicePrefs';
import { toast } from '../../../app/ui';
import { Switch } from '../SettingsLayout';

/** dBFS (-100 … 0) as a 0-100 meter position. */
const pct = (db: number) => Math.max(0, Math.min(100, db + 100));

/** Discord's Mic Test and input sensitivity: hear yourself, see your level and the threshold. */
export function MicTest() {
  const prefs = useVoicePrefs();
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(-100);
  const [threshold, setThreshold] = useState(prefs.thresholdDb);
  const stopRef = useRef<() => void>(() => {});
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => () => stopRef.current(), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: inputDeviceId(), echoCancellation: true, noiseSuppression: true } });
      const track = stream.getAudioTracks()[0];
      const stopWatch = watchLevel(track, (db, t) => {
        setLevel(db);
        setThreshold(t);
      });
      // Play it back, so you hear what others hear.
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        void audioRef.current.play().catch(() => undefined);
      }
      stopRef.current = () => {
        stopWatch();
        stream.getTracks().forEach((t) => t.stop());
        if (audioRef.current) audioRef.current.srcObject = null;
        setLevel(-100);
      };
      setRunning(true);
    } catch (err) {
      toast(`Microphone unavailable: ${(err as Error).message}`, 'error');
    }
  };
  const stop = () => {
    stopRef.current();
    setRunning(false);
  };
  const speaking = level >= threshold;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[15px] font-semibold text-fg">Mic Test</p>
        <p className="mt-0.5 text-sm text-fg-muted">Having mic issues? Start a test and say something silly. We&apos;ll play your voice back to you.</p>
        <div className="mt-3 flex items-center gap-4">
          <Button onClick={() => (running ? stop() : void start())} variant={running ? 'secondary' : 'primary'}>
            {running ? 'Stop Testing' : "Let's Check"}
          </Button>
          <div role="meter" aria-label="Input level" aria-valuemin={-100} aria-valuemax={0} aria-valuenow={Math.round(level)} className="relative h-2 flex-1 overflow-hidden rounded-full bg-raised">
            <div className={clsx('h-full transition-[width] duration-75', speaking ? 'bg-online' : 'bg-fg-subtle')} style={{ width: `${pct(level)}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-star" style={{ left: `${pct(threshold)}%` }} aria-hidden />
          </div>
        </div>
        <audio ref={audioRef} hidden />
      </div>
      <div>
        <p className="text-[15px] font-semibold text-fg">Input Sensitivity</p>
        <Switch
          label="Automatically determine input sensitivity"
          description="Adjusts to the background noise around you."
          checked={prefs.autoSensitivity}
          onChange={(v) => setVoicePrefs({ autoSensitivity: v })}
        />
        {!prefs.autoSensitivity && (
          <div className="flex items-center gap-3 pt-2">
            <input
              type="range"
              aria-label="Input sensitivity"
              min={-100}
              max={0}
              value={prefs.thresholdDb}
              onChange={(e) => setVoicePrefs({ thresholdDb: Number(e.target.value) })}
              className="flex-1 accent-[var(--color-brand)]"
            />
            <span className="w-16 text-right text-sm tabular-nums text-fg-muted">{prefs.thresholdDb} dB</span>
          </div>
        )}
        <p className="mt-1 text-xs text-fg-subtle">Below the line, your microphone sends silence. Run the mic test to see where you are.</p>
      </div>
    </div>
  );
}

/** "Backquote" → "`", "KeyV" → "V", "F13" → "F13": how a key code reads. */
const keyLabel = (code: string | null) =>
  !code ? 'Not set' : code === 'Backquote' ? '`' : code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace(/(Left|Right)$/, ' $1');

/** Press a key to bind it; Escape cancels, Backspace clears. */
function KeyRecorder({ label, value, onChange }: { label: string; value: string | null; onChange: (code: string | null) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setListening(false);
      if (e.code === 'Escape') return;
      onChange(e.code === 'Backspace' ? null : e.code);
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [listening, onChange]);
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-fg">{label}</span>
      <button
        type="button"
        aria-label={`${label}: ${keyLabel(value)}`}
        onClick={() => setListening(true)}
        className={clsx('min-w-32 rounded-md px-3 py-1.5 text-sm font-semibold ring-1', listening ? 'bg-brand-soft text-brand-sky ring-brand' : 'bg-void text-fg ring-line-strong hover:ring-fg-subtle')}
      >
        {listening ? 'Press a key…' : keyLabel(value)}
      </button>
    </div>
  );
}

/** Voice & Video › Input Mode: voice activity or push-to-talk, and the Priority Speaker key. */
export function InputModeSettings() {
  const prefs = useVoicePrefs();
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Input Mode" className="space-y-2">
        {(
          [
            ['voice', 'Voice Activity', 'Talk whenever you speak.'],
            ['ptt', 'Push to Talk', 'Hold your key to talk.'],
          ] as const
        ).map(([mode, title, hint]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={prefs.inputMode === mode}
            onClick={() => setVoicePrefs({ inputMode: mode })}
            className={clsx('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left', prefs.inputMode === mode ? 'bg-active' : 'bg-raised hover:bg-hover')}
          >
            <span className={clsx('h-4 w-4 rounded-full border-2', prefs.inputMode === mode ? 'border-brand bg-brand' : 'border-fg-subtle')} />
            <span>
              <span className="block text-sm font-semibold text-fg">{title}</span>
              <span className="block text-xs text-fg-muted">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <KeyRecorder label="Push to Talk key" value={prefs.pttKey} onChange={(pttKey) => setVoicePrefs({ pttKey })} />
      <KeyRecorder label="Priority Speaker key" value={prefs.priorityKey} onChange={(priorityKey) => setVoicePrefs({ priorityKey })} />
      <p className="text-xs text-fg-muted">
        Comm-links where you lack Use Voice Activity always use push-to-talk. The Priority Speaker key works where you have Priority Speaker: while you hold it and talk, others are quieter.
      </p>
    </div>
  );
}
