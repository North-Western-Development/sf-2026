import { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Download, Trash2 } from 'lucide-react';
import { Modal } from '@subspace/ui';
import { closeModal, confirmAction } from '../../app/ui';
import { useVoice } from './session';
import { ControlButton } from './ControlButton';
import { CLIP_LENGTHS, deleteClip, listClips, saveClip, setClipPrefs, useClipPrefs, useClipsVersion, type Clip } from './clips';
import { RadioList, Switch } from '../settings/SettingsLayout';

/** In the comm-link controls while Holo-Casting with clips on. */
export function ClipButton() {
  const enabled = useClipPrefs((s) => s.enabled);
  const streaming = useVoice((s) => s.screenOn);
  const [busy, setBusy] = useState(false);
  if (!enabled || !streaming) return null;
  return (
    <ControlButton
      label="Clip (Ctrl + Shift + C)"
      active={busy}
      onClick={async () => {
        setBusy(true);
        await saveClip();
        setBusy(false);
      }}
    >
      <Clapperboard className="h-5 w-5" />
    </ControlButton>
  );
}

/** Voice & Video › Clips. */
export function ClipSettings() {
  const { enabled, length } = useClipPrefs();
  return (
    <>
      <Switch
        label="Enable Clips"
        description="While you Holo-Cast, keep the last stretch of your stream and the comm-link's audio on this device so you can save it with Ctrl + Shift + C. Nothing is uploaded."
        checked={enabled}
        onChange={(v) => setClipPrefs({ enabled: v })}
      />
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase text-fg-muted">Clip Length</p>
        <RadioList
          label="Clip Length"
          value={String(length)}
          onChange={(v) => setClipPrefs({ length: Number(v) as (typeof CLIP_LENGTHS)[number] })}
          options={CLIP_LENGTHS.map((s) => ({ value: String(s), label: s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}` }))}
        />
      </div>
    </>
  );
}

function ClipCard({ clip, onDelete }: { clip: Clip; onDelete: () => void }) {
  const url = useMemo(() => URL.createObjectURL(clip.blob), [clip.blob]);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const seconds = Math.round((clip.durationMs - clip.trimStartMs) / 1000);
  return (
    <li className="overflow-hidden rounded-lg bg-raised ring-1 ring-line">
      <video
        ref={video}
        src={url}
        controls
        preload="metadata"
        aria-label={clip.title}
        className="block aspect-video w-full bg-void"
        // Start at the kept part: the recording may hold a little more before it.
        onLoadedMetadata={() => video.current && (video.current.currentTime = clip.trimStartMs / 1000)}
      />
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{clip.title}</span>
          <span className="text-xs text-fg-muted">{seconds}s</span>
        </span>
        <a href={url} download={`${clip.title.replace(/[^\w-]+/g, '-')}.webm`} aria-label={`Download ${clip.title}`} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
          <Download className="h-4 w-4" />
        </a>
        <button type="button" aria-label={`Delete ${clip.title}`} onClick={onDelete} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-danger">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

/** Your clips on this device (profile menu › Clips). */
export function ClipsModal() {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const version = useClipsVersion((s) => s.v);
  useEffect(() => {
    void listClips().then(setClips, () => setClips([]));
  }, [version]);
  return (
    <Modal isOpen onClose={closeModal} title="Clips" description="Saved on this device only." maxWidth="2xl">
      {clips === null ? (
        <p className="text-sm text-fg-subtle">Loading…</p>
      ) : clips.length ? (
        <ul aria-label="Clips" className="grid gap-3 sm:grid-cols-2">
          {clips.map((c) => (
            <ClipCard
              key={c.id}
              clip={c}
              onDelete={() =>
                confirmAction({
                  title: 'Delete Clip',
                  body: `Delete "${c.title}"? It is only on this device, so it cannot be recovered.`,
                  confirmLabel: 'Delete',
                  danger: true,
                  onConfirm: async () => {
                    await deleteClip(c.id);
                    setClips((list) => list?.filter((x) => x.id !== c.id) ?? null);
                  },
                })
              }
            />
          ))}
        </ul>
      ) : (
        <div className="py-8 text-center">
          <Clapperboard className="mx-auto h-10 w-10 text-fg-subtle" />
          <p className="mt-3 font-semibold text-fg">No clips yet</p>
          <p className="mt-1 text-sm text-fg-muted">Turn on Clips in Voice & Video settings, Holo-Cast, then press Ctrl + Shift + C.</p>
        </div>
      )}
    </Modal>
  );
}
