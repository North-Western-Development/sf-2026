import { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { clsx } from 'clsx';
import { checkImage } from '../../lib/explicitFilter';

/**
 * An image that, when `filter` is on, stays blurred while it is checked on this device, and
 * stays blurred with a click-to-show cover if it looks explicit (Discord's sensitive media).
 */
export function SafeImage({ src, alt, className, filter }: { src: string; alt: string; className?: string; filter: boolean }) {
  const [state, setState] = useState<'checking' | 'ok' | 'explicit'>(filter ? 'checking' : 'ok');
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!filter) return setState('ok');
    let live = true;
    setState('checking');
    void checkImage(src).then((explicit) => live && setState(explicit ? 'explicit' : 'ok'));
    return () => {
      live = false;
    };
  }, [src, filter]);
  const hidden = state !== 'ok' && !shown;
  return (
    <span className="relative block overflow-hidden">
      <img src={src} alt={alt} loading="lazy" className={clsx(className, hidden && 'scale-110 blur-2xl')} />
      {state === 'explicit' && !shown && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShown(true);
          }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-void/40 text-sm font-semibold text-fg"
        >
          <EyeOff className="h-6 w-6" />
          Explicit content. Click to show.
        </button>
      )}
    </span>
  );
}
