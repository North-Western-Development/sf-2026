import { useEffect, useState } from 'react';
import { Download, FileText, Lock, LockKeyhole } from 'lucide-react';
import type { Transmission } from '../../lib/types';
import { openFile } from '../../lib/e2ee/client';
import { formatBytes } from '../../lib/time';

/** What shows instead of text while an encrypted transmission is sealed or cannot be opened. */
export function SealedNotice({ state }: { state: Transmission['e2ee'] }) {
  if (state === 'pending') return <span className="italic text-fg-subtle">Decrypting…</span>;
  return (
    <span className="flex items-center gap-1.5 italic text-fg-subtle">
      <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
      {state === 'other-device'
        ? 'This transmission was encrypted for other devices, so it cannot be read here.'
        : 'This transmission could not be decrypted.'}
    </span>
  );
}

function SealedFile({ file }: { file: NonNullable<Transmission['encryptedAttachments']>[number] }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isImage = file.mimeType.startsWith('image/') && file.mimeType !== 'image/svg+xml';
  useEffect(() => {
    let live = true;
    if (isImage) openFile(file.url, file.key, file.mimeType).then((u) => live && setSrc(u), () => live && setError(true));
    return () => {
      live = false;
    };
  }, [file.url, file.key, file.mimeType, isImage]);

  const download = async () => {
    const url = await openFile(file.url, file.key, file.mimeType);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
  };

  if (isImage && src) return <img src={src} alt={file.filename} className="max-h-[350px] max-w-[400px] rounded-md object-contain" />;
  return (
    <div className="flex max-w-[432px] items-center gap-3 rounded-md border border-line bg-raised p-3">
      <FileText className="h-8 w-8 shrink-0 text-brand-sky" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 truncate text-sm text-fg">
          <Lock className="h-3 w-3 shrink-0 text-online" aria-label="Encrypted" />
          <span className="truncate">{file.filename}</span>
        </p>
        <span className="text-xs text-fg-subtle">{error ? 'Could not decrypt' : formatBytes(file.size)}</span>
      </div>
      <button type="button" aria-label={`Download ${file.filename}`} onClick={() => void download()} className="text-fg-subtle hover:text-fg">
        <Download className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Attachments that were encrypted on the sender's device, opened here. */
export function SealedAttachments({ items }: { items: Transmission['encryptedAttachments'] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {items.map((f) => (
        <SealedFile key={f.url} file={f} />
      ))}
    </div>
  );
}
