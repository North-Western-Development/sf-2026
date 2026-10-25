import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, RotateCw } from 'lucide-react';
import { Button, Modal } from '@subspace/ui';

const BOX_W = 460;
const BOX_H = 280;

/**
 * Discord's "Edit Image": drag to position, zoom, rotate, then Apply crops to `aspect` and
 * returns a file at `outputWidth` (height follows the aspect).
 */
export function ImageCropDialog({ file, aspect, outputWidth, onApply, onCancel }: { file: File; aspect: number; outputWidth: number; onApply: (file: File) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0); // quarter turns
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // The object URL is made and revoked by the same effect run (StrictMode runs effects twice).
  useEffect(() => {
    const u = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setUrl(u);
      setImg(el);
    };
    el.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const frameW = BOX_W - 24;
  const frameH = Math.min(BOX_H - 24, frameW / aspect);
  const fw = frameH * aspect;
  const sideways = turn % 2 === 1;
  const rw = img ? (sideways ? img.naturalHeight : img.naturalWidth) : 1;
  const rh = img ? (sideways ? img.naturalWidth : img.naturalHeight) : 1;
  // Cover the frame at zoom 1.
  const scale = Math.max(fw / rw, frameH / rh) * zoom;
  const clamp = (o: { x: number; y: number }) => {
    const mx = Math.max(0, (rw * scale - fw) / 2);
    const my = Math.max(0, (rh * scale - frameH) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };
  useEffect(() => setOff((o) => clamp(o)), [zoom, turn, img]);

  const apply = async () => {
    if (!img) return;
    const outW = outputWidth;
    const outH = Math.round(outputWidth / aspect);
    const k = outW / fw;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(outW / 2 + off.x * k, outH / 2 + off.y * k);
    ctx.rotate((turn * Math.PI) / 2);
    ctx.scale(scale * k, scale * k);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const type = file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
    if (blob) onApply(new File([blob], type === 'image/png' ? 'cover.png' : 'cover.jpg', { type }));
  };

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title="Edit Image"
      maxWidth="lg"
      footer={
        <div className="flex w-full items-center">
          <Button
            variant="link"
            onClick={() => {
              setZoom(1);
              setTurn(0);
              setOff({ x: 0, y: 0 });
            }}
          >
            Reset
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={() => void apply()} disabled={!img}>
              Apply
            </Button>
          </div>
        </div>
      }
    >
      <div
        aria-label="Crop area. Drag to move the image."
        className="relative mx-auto cursor-move touch-none overflow-hidden rounded-lg bg-raised"
        style={{ width: BOX_W, maxWidth: '100%', height: BOX_H }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {img && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            style={{ width: img.naturalWidth, height: img.naturalHeight, transform: `translate(-50%, -50%) translate(${off.x}px, ${off.y}px) rotate(${turn * 90}deg) scale(${scale})` }}
          />
        )}
        {/* The crop frame; everything outside it is dimmed. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm ring-2 ring-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" style={{ width: fw, height: frameH }} />
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <ImageIcon className="h-3.5 w-3.5 text-fg-muted" />
        <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="w-40 accent-[var(--color-brand)]" />
        <ImageIcon className="h-5 w-5 text-fg-muted" />
        <button type="button" aria-label="Rotate" onClick={() => setTurn((t) => (t + 1) % 4)} className="ml-6 flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
          <RotateCw className="h-5 w-5" />
        </button>
      </div>
    </Modal>
  );
}
