import { clsx } from 'clsx';
import { Tooltip } from '@subspace/ui';

/** A round call control (mute, camera, soundboard, disconnect). */
export function ControlButton({ label, onClick, active, danger, children }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; active?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={clsx(
          'flex h-12 w-12 items-center justify-center rounded-full transition-colors',
          danger ? 'bg-danger text-white hover:brightness-110' : active ? 'bg-fg text-void' : 'bg-overlay text-fg hover:bg-hover'
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}
