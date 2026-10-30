import { useEffect, useRef } from 'react';

export type SwipeDirection = 'left' | 'right';

export interface SwipeHandlers {
  /** The gesture turned out horizontal: return true to take it (the page then stops scrolling with it). */
  start: (dir: SwipeDirection, target: HTMLElement) => boolean;
  /** Each move while it is taken, with how far the finger has gone (negative is left). */
  move?: (dx: number) => void;
  /** The finger lifted (or the browser took the touch over: cancelled). */
  end: (dx: number, cancelled: boolean) => void;
}

/** Text being edited, sliders and the like keep their own horizontal drags. */
const OWN_DRAG = 'input, textarea, select, [contenteditable="true"], [role="slider"], video, [data-no-swipe]';

/** Something between the target and the element that scrolls sideways itself (a code block, a row of chips). */
function scrollsSideways(target: HTMLElement, root: HTMLElement, dir: SwipeDirection) {
  for (let el: HTMLElement | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue;
    const overflow = getComputedStyle(el).overflowX;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    // A finger moving right scrolls the content back towards its start.
    if (dir === 'right' ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  }
  return false;
}

/**
 * Horizontal swipes on a touch screen, told apart from vertical scrolling: a gesture counts once
 * the finger has moved 10px, mostly sideways. Native listeners, so React portals (dialogs,
 * menus) rendered from inside the element are not part of it.
 */
export function useSwipe(ref: React.RefObject<HTMLElement | null>, handlers: SwipeHandlers) {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let target: HTMLElement | null = null;
    let state: 'idle' | 'pending' | 'taken' | 'ignored' = 'idle';

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (state === 'taken') h.current.end(dx, true);
        state = 'ignored';
        return;
      }
      target = e.target as HTMLElement;
      state = target.closest(OWN_DRAG) ? 'ignored' : 'pending';
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      dx = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (state === 'idle' || state === 'ignored' || !target) return;
      dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (state === 'pending') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        const dir: SwipeDirection = dx < 0 ? 'left' : 'right';
        state = Math.abs(dx) > Math.abs(dy) * 1.5 && !scrollsSideways(target, el, dir) && h.current.start(dir, target) ? 'taken' : 'ignored';
        if (state !== 'taken') return;
      }
      if (e.cancelable) e.preventDefault();
      h.current.move?.(dx);
    };
    const onEnd = (e: TouchEvent) => {
      if (state === 'taken') h.current.end(dx, e.type === 'touchcancel');
      state = 'idle';
      target = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref]);
}

/** A short buzz where the device has one (Android; iOS has no vibration API). */
export const tick = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not allowed here */
  }
};

const LONG_PRESS_MS = 450;
/** Text fields keep the system's own long-press (select, paste). */
const NATIVE_PRESS = 'input, textarea, select, [contenteditable="true"], [data-context-menu]';

/**
 * Touch screens: holding a finger still opens the same menu a right-click does (iOS never sends
 * one; Android sends its own, which this replaces so it opens once and without text selection).
 */
export function startLongPress() {
  if (!window.matchMedia?.('(pointer: coarse)').matches) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let x0 = 0;
  let y0 = 0;
  let byTouch = false;
  let fired = false;

  const cancel = () => clearTimeout(timer);
  // What started the latest press: a mouse's right-click still opens its menu as usual.
  window.addEventListener('pointerdown', (e) => (byTouch = e.pointerType === 'touch'), { capture: true });
  window.addEventListener(
    'touchstart',
    (e) => {
      cancel();
      fired = false;
      const target = e.target as HTMLElement;
      if (e.touches.length !== 1 || target.closest?.(NATIVE_PRESS)) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      timer = setTimeout(() => {
        fired = true;
        tick();
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 2 }));
      }, LONG_PRESS_MS);
    },
    { passive: true, capture: true }
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (Math.abs(e.touches[0].clientX - x0) > 10 || Math.abs(e.touches[0].clientY - y0) > 10) cancel();
    },
    { passive: true, capture: true }
  );
  const end = (e: TouchEvent) => {
    cancel();
    if (!fired) return;
    // The finger lifting is not also a tap on whatever the menu put under it.
    fired = false;
    if (e.cancelable) e.preventDefault();
  };
  window.addEventListener('touchend', end, { capture: true, passive: false });
  window.addEventListener('touchcancel', end, { capture: true });
  // The browser's own long-press menu event: ours stands in for it.
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (!e.isTrusted || !byTouch || (e.target as HTMLElement).closest?.(NATIVE_PRESS)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true }
  );
}
