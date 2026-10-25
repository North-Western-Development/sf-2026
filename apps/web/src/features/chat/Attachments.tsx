import { Download, FileText } from 'lucide-react';
import type { Transmission } from '../../lib/types';
import { useChatPrefs } from '../../lib/chatPrefs';
import { formatBytes } from '../../lib/time';

/** A transmission's files: images and video inline (unless turned off), the rest as file cards. */
export function Attachments({ items }: { items: Transmission['attachments'] }) {
  const inline = useChatPrefs((p) => p.inlineMedia);
  if (!items.length) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {items.map((a) => {
        const isImage = inline && (a.mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(a.filename));
        const isVideo = inline && (a.mimeType?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(a.filename));
        if (isImage)
          return (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer noopener" className="block max-w-[400px] overflow-hidden rounded-md">
              <img src={a.url} alt={a.filename} loading="lazy" className="max-h-[350px] w-auto object-contain" />
            </a>
          );
        if (isVideo) return <video key={a.id} src={a.url} controls className="max-h-[350px] max-w-[400px] rounded-md" />;
        return (
          <div key={a.id} className="flex max-w-[432px] items-center gap-3 rounded-md border border-line bg-raised p-3">
            <FileText className="h-8 w-8 shrink-0 text-brand-sky" />
            <div className="min-w-0 flex-1">
              <a href={a.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm text-brand-sky hover:underline">
                {a.filename}
              </a>
              <span className="text-xs text-fg-subtle">{formatBytes(a.size)}</span>
            </div>
            <a href={a.url} download={a.filename} aria-label={`Download ${a.filename}`} className="text-fg-subtle hover:text-fg">
              <Download className="h-5 w-5" />
            </a>
          </div>
        );
      })}
    </div>
  );
}
