import React, { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: React.ReactNode;
  placement?: Placement;
  delay?: number;
  /** Render nothing extra when false (content still labels the child for a11y). */
  disabled?: boolean;
  children: React.ReactElement;
}

const GAP = 8;

export function Tooltip({ content, placement = 'top', delay = 250, disabled, children }: TooltipProps) {
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipRef = useRef<HTMLDivElement>(null);

  const show = useCallback(
    (el: HTMLElement) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAnchor(el.getBoundingClientRect()), delay);
    },
    [delay]
  );
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setAnchor(null);
    setPos(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!anchor || !tipRef.current) return;
    const tip = tipRef.current.getBoundingClientRect();
    let x = 0;
    let y = 0;
    if (placement === 'top') {
      x = anchor.left + anchor.width / 2 - tip.width / 2;
      y = anchor.top - tip.height - GAP;
    } else if (placement === 'bottom') {
      x = anchor.left + anchor.width / 2 - tip.width / 2;
      y = anchor.bottom + GAP;
    } else if (placement === 'right') {
      x = anchor.right + GAP;
      y = anchor.top + anchor.height / 2 - tip.height / 2;
    } else {
      x = anchor.left - tip.width - GAP;
      y = anchor.top + anchor.height / 2 - tip.height / 2;
    }
    x = Math.min(Math.max(8, x), window.innerWidth - tip.width - 8);
    y = Math.min(Math.max(8, y), window.innerHeight - tip.height - 8);
    setPos({ x, y });
  }, [anchor, placement]);

  if (!isValidElement(children)) return children;
  const child = children as React.ReactElement<any>;

  const trigger = cloneElement(child, {
    'aria-describedby': anchor && !disabled ? id : child.props['aria-describedby'],
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      child.props.onMouseEnter?.(e);
      if (!disabled) show(e.currentTarget);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      child.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      child.props.onFocus?.(e);
      if (!disabled) show(e.currentTarget);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      child.props.onBlur?.(e);
      hide();
    },
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      child.props.onMouseDown?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {anchor &&
        !disabled &&
        content &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={clsx(
              'fixed z-[3000] pointer-events-none max-w-[260px] rounded-md bg-overlay px-3 py-2 text-sm font-medium text-fg shadow-pop',
              'animate-[fade-in_100ms_ease-out]'
            )}
            style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Greyed-out placeholder for features that exist in Discord but have no backend yet.
 * The child keeps its layout but is inert and shows a "Coming soon" tooltip.
 */
export function ComingSoon({
  children,
  label,
  placement = 'top',
  className,
}: {
  children: React.ReactNode;
  label?: string;
  placement?: Placement;
  className?: string;
}) {
  return (
    <Tooltip placement={placement} content={<span>{label ? `${label}: ` : ''}Coming soon</span>}>
      <span
        aria-disabled="true"
        data-coming-soon
        tabIndex={0}
        className={clsx('inline-flex opacity-40 grayscale cursor-not-allowed select-none [&_*]:pointer-events-none', className)}
        onClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </span>
    </Tooltip>
  );
}
