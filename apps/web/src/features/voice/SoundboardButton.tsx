import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines } from 'lucide-react';
import { useStore } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { Emoji } from '../../lib/emoji';
import { term } from '../../lib/strings';
import { ControlButton } from './ControlButton';
import { DEFAULT_SOUNDS, loadSounds, sendSound, useSounds } from './soundboard';

/** Discord's soundboard: built-in sounds and the beacon's, played to everyone in the comm-link. */
export function SoundboardButton({ relayId, beaconId }: { relayId: string; beaconId: string }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const sounds = useSounds((s) => s[beaconId]);
  const beaconName = useStore((s) => s.beacons[beaconId]?.name ?? '');
  const allowed = useStore((s) => can(relayPermissions(s, relayId), PERMISSIONS.USE_SOUNDBOARD));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    void loadSounds(beaconId);
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setAnchor(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAnchor(null);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [anchor, beaconId]);
  if (!allowed) return null;

  const tile = (key: string, label: string, emoji: string | null, onClick: () => void) => (
    <button key={key} type="button" aria-label={`Play ${label}`} onClick={onClick} className="flex h-10 items-center gap-2 rounded-md bg-raised px-2 text-left text-sm text-fg hover:bg-hover">
      {emoji ? <Emoji emoji={emoji} size={18} /> : <AudioLines className="h-4 w-4 text-fg-muted" />}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <>
      <ControlButton label="Open Soundboard" active={!!anchor} onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}>
        <AudioLines className="h-5 w-5" />
      </ControlButton>
      {anchor &&
        createPortal(
          <div
            ref={ref}
            role="dialog"
            aria-label="Soundboard"
            className="fixed z-[1500] w-80 rounded-xl bg-overlay p-3 shadow-pop ring-1 ring-line"
            style={{ left: Math.max(8, Math.min(window.innerWidth - 328, anchor.left + anchor.width / 2 - 160)), bottom: window.innerHeight - anchor.top + 8 }}
          >
            <p className="mb-2 text-xs font-semibold uppercase text-fg-muted">Default Sounds</p>
            <div className="grid grid-cols-2 gap-1.5">{DEFAULT_SOUNDS.map((d) => tile(d.id, d.name, d.emoji, () => void sendSound(relayId, { defaultSound: d.id })))}</div>
            <p className="mb-2 mt-3 text-xs font-semibold uppercase text-fg-muted">{beaconName}</p>
            {sounds === undefined ? (
              <p className="text-sm text-fg-subtle">Loading…</p>
            ) : sounds.length ? (
              <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto">{sounds.map((s) => tile(s.id, s.name, s.emoji, () => void sendSound(relayId, { soundId: s.id })))}</div>
            ) : (
              <p className="text-sm text-fg-subtle">No sounds yet. Admins add them in {term('beacon')} Settings › Soundboard.</p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
