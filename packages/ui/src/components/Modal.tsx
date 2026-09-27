import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Action row pinned to the bottom of the dialog (buttons right-aligned). */
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  /** Large fixed-size dialog with a scrolling body (settings-style). */
  fixedDimensions?: boolean;
  /** Hide the close button (e.g. blocking gates). Escape and backdrop still call onClose. */
  hideCloseButton?: boolean;
  /** Prevent closing via Escape / backdrop click. */
  dismissible?: boolean;
  className?: string;
}

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
} as const;

// Stack depth so nested dialogs layer and only the top one reacts to Escape.
let openStack: string[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The single dialog shell used across Subspace. Every modal shares this overlay,
 * surface, radius, header and footer treatment.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
  fixedDimensions = false,
  hideCloseButton = false,
  dismissible = true,
  className,
}) => {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    openStack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab' && panel) {
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const firstNode = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === firstNode) {
          e.preventDefault();
          lastNode.focus();
        } else if (!e.shiftKey && document.activeElement === lastNode) {
          e.preventDefault();
          firstNode.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      openStack = openStack.filter((x) => x !== id);
      if (openStack.length === 0) document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [isOpen, id, dismissible]);

  if (!isOpen) return null;

  const depth = Math.max(0, openStack.indexOf(id));

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-[fade-in_120ms_ease-out]"
      style={{ zIndex: 1000 + depth * 10 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? `${id}-title` : undefined}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={clsx(
          'relative flex flex-col bg-overlay text-fg rounded-2xl shadow-modal outline-none overflow-hidden',
          fixedDimensions ? 'w-[880px] h-[640px] max-w-[95vw] max-h-[88vh]' : clsx('w-full max-h-[88vh]', WIDTHS[maxWidth]),
          className
        )}
      >
        {!hideCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 z-10 text-fg-subtle hover:text-fg hover:bg-hover p-1.5 rounded-md transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {(title || description) && (
          <header className="px-6 pt-6 pb-2 pr-14 shrink-0">
            {title && (
              <h2 id={`${id}-title`} className="text-xl font-semibold text-fg">
                {title}
              </h2>
            )}
            {description && (
              <p id={`${id}-desc`} className="mt-1.5 text-sm text-fg-muted leading-relaxed">
                {description}
              </p>
            )}
          </header>
        )}

        <div className={clsx('px-6 py-4 min-h-0 overflow-y-auto', fixedDimensions && 'flex-1')}>{children}</div>

        {footer && (
          <footer className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 bg-raised border-t border-line">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
};
