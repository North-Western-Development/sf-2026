import { useEffect, useState } from 'react';
import { Play, Trash2, Upload } from 'lucide-react';
import { Button, Input } from '@subspace/ui';
import { http } from '../../../lib/http';
import { pickAudio, pickImage, uploadMedia } from '../../../lib/media';
import { Emoji } from '../../../lib/emoji';
import { term } from '../../../lib/strings';
import { confirmAction, toast } from '../../../app/ui';
import { EmojiPicker } from '../../chat/EmojiPicker';
import { invalidateStickers, type Sticker } from '../../chat/ExpressionPanels';
import { playLocal, DEFAULT_SOUNDS, type Sound } from '../../voice/soundboard';
import { SettingsTitle, SettingsSection, Field } from '../SettingsLayout';

function EmojiField({ value, onChange, label }: { value: string | null; onChange: (v: string) => void; label: string }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button type="button" aria-label={label} onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} className="flex h-10 w-14 items-center justify-center rounded-md border border-line bg-void hover:border-fg-subtle">
        {value ? <Emoji emoji={value} size={22} /> : <span className="text-fg-subtle">+</span>}
      </button>
      {anchor && (
        <EmojiPicker
          anchor={anchor}
          glyphs="none"
          onClose={() => setAnchor(null)}
          onPick={(e) => {
            onChange(e);
            setAnchor(null);
          }}
        />
      )}
    </>
  );
}

/** Discord's Stickers page: upload, name and tag stickers members can send. */
export function StickersTab({ beaconId }: { beaconId: string }) {
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    http.get<{ stickers: Sticker[] }>(`/beacons/${beaconId}/stickers`).then((r) => setStickers(r.stickers));
  }, [beaconId]);

  const upload = async () => {
    if (!file || !emoji || name.trim().length < 2) return;
    setBusy(true);
    try {
      const url = await uploadMedia('sticker', file);
      const res = await http.post<{ sticker: Sticker }>(`/beacons/${beaconId}/stickers`, { name: name.trim(), emoji, description: description.trim() || null, url });
      setStickers((s) => [...(s ?? []), res.sticker]);
      invalidateStickers();
      setFile(null);
      setName('');
      setEmoji(null);
      setDescription('');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsTitle>Stickers</SettingsTitle>
      <p className="-mt-4 mb-6 text-sm text-fg-muted">Members of any {term('beacon').toLowerCase()} you share can send these. PNG, APNG, GIF or WebP, up to 512 KB; 320×320 looks best.</p>
      <SettingsSection id="upload" title="Upload Sticker">
        <div className="flex gap-4">
          <button type="button" aria-label="Choose sticker image" onClick={() => void pickImage().then((f) => f && setFile(f))} className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-strong bg-void hover:border-fg-subtle">
            {file ? <img src={URL.createObjectURL(file)} alt="" className="max-h-full max-w-full object-contain" /> : <Upload className="h-6 w-6 text-fg-subtle" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <Field label="Sticker Name">
                <Input aria-label="Sticker name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Related Emoji">
                <EmojiField label="Related emoji" value={emoji} onChange={setEmoji} />
              </Field>
            </div>
            <Field label="Description">
              <Input aria-label="Sticker description" value={description} maxLength={100} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Button onClick={() => void upload()} isLoading={busy} disabled={!file || !emoji || name.trim().length < 2}>
              Upload
            </Button>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection id="list" title={`Stickers — ${stickers?.length ?? 0} of 30`}>
        <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
          {stickers?.map((s) => (
            <figure key={s.id} className="group relative rounded-lg bg-raised p-2 text-center">
              <img src={s.url} alt="" className="mx-auto h-24 w-24 object-contain" />
              <figcaption className="mt-1 flex items-center justify-center gap-1 truncate text-sm text-fg">
                <Emoji emoji={s.emoji} size={14} /> {s.name}
              </figcaption>
              <button
                type="button"
                aria-label={`Delete sticker ${s.name}`}
                onClick={() =>
                  confirmAction({
                    title: `Delete ${s.name}`,
                    body: 'Members will no longer be able to send it. Transmissions that already have it keep it.',
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: async () => {
                      await http.delete(`/beacons/${beaconId}/stickers/${s.id}`);
                      setStickers((x) => (x ?? []).filter((y) => y.id !== s.id));
                      invalidateStickers();
                    },
                  })
                }
                className="absolute right-1 top-1 rounded-md bg-void/80 p-1 text-danger opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </figure>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}

/** Reads a sound's length so clips over 5 seconds can be refused, as Discord does. */
const durationOf = (file: File) =>
  new Promise<number>((resolve) => {
    const a = new Audio(URL.createObjectURL(file));
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => resolve(0);
  });

/** Discord's Soundboard page: the built-in sounds and up to 24 of the beacon's own. */
export function SoundboardTab({ beaconId }: { beaconId: string }) {
  const [sounds, setSounds] = useState<Sound[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [volume, setVolume] = useState(100);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    http.get<{ sounds: Sound[] }>(`/beacons/${beaconId}/sounds`).then((r) => setSounds(r.sounds));
  }, [beaconId]);

  const choose = async () => {
    const f = await pickAudio();
    if (!f) return;
    if ((await durationOf(f)) > 5.2) return toast('Sounds can be up to 5 seconds long.', 'error');
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 32));
  };
  const upload = async () => {
    if (!file || name.trim().length < 2) return;
    setBusy(true);
    try {
      const url = await uploadMedia('sound', file);
      const res = await http.post<{ sound: Sound }>(`/beacons/${beaconId}/sounds`, { name: name.trim(), emoji, url, volume });
      setSounds((s) => [...(s ?? []), res.sound]);
      setFile(null);
      setName('');
      setEmoji(null);
      setVolume(100);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsTitle>Soundboard</SettingsTitle>
      <p className="-mt-4 mb-6 text-sm text-fg-muted">Members with Use Soundboard can play these in any {term('commLink').toLowerCase()}. MP3, OGG, WAV or WebM, up to 512 KB and 5 seconds.</p>
      <SettingsSection id="upload" title="Upload Sound">
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Sound Name">
            <Input aria-label="Sound name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Emoji">
            <EmojiField label="Sound emoji" value={emoji} onChange={setEmoji} />
          </Field>
        </div>
        <Field label={`Volume — ${volume}%`}>
          <input type="range" aria-label="Sound volume" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full accent-[var(--color-brand)]" />
        </Field>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => void choose()}>
            {file ? file.name : 'Choose File'}
          </Button>
          {file && (
            <Button variant="secondary" aria-label="Preview sound" onClick={() => playLocal({ url: URL.createObjectURL(file), volume })}>
              <Play className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={() => void upload()} isLoading={busy} disabled={!file || name.trim().length < 2}>
            Upload
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection id="list" title={`Sounds — ${sounds?.length ?? 0} of 24`}>
        <ul className="space-y-1">
          {DEFAULT_SOUNDS.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
              <Emoji emoji={d.emoji} size={18} />
              <span className="flex-1 text-sm text-fg">{d.name}</span>
              <span className="text-xs text-fg-subtle">Default</span>
              <button type="button" aria-label={`Preview ${d.name}`} onClick={() => playLocal({ defaultSound: d.id })} className="rounded p-1 text-fg-muted hover:text-fg">
                <Play className="h-4 w-4" />
              </button>
            </li>
          ))}
          {sounds?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
              {s.emoji ? <Emoji emoji={s.emoji} size={18} /> : <span className="w-[18px]" />}
              <span className="flex-1 text-sm text-fg">{s.name}</span>
              <span className="text-xs text-fg-subtle">{s.volume}%</span>
              <button type="button" aria-label={`Preview ${s.name}`} onClick={() => playLocal(s)} className="rounded p-1 text-fg-muted hover:text-fg">
                <Play className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Delete sound ${s.name}`}
                onClick={() =>
                  confirmAction({
                    title: `Delete ${s.name}`,
                    body: 'It will be removed from the soundboard.',
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: async () => {
                      await http.delete(`/beacons/${beaconId}/sounds/${s.id}`);
                      setSounds((x) => (x ?? []).filter((y) => y.id !== s.id));
                    },
                  })
                }
                className="rounded p-1 text-danger hover:brightness-110"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </SettingsSection>
    </>
  );
}
