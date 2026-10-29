/** The thumb's fixed length and its gap from the ends of what scrolls. */
const THUMB = 36;
const PAD = 4;

/**
 * Touch screens: the page's scrollbars are hidden (index.css, html[data-touch]) and whatever is
 * scrolling shows one thin thumb of a fixed length instead, like the phone's own lists. More
 * content makes it travel more slowly rather than shrink; it fades soon after scrolling stops.
 */
export function startTouchScrollIndicator() {
  if (!window.matchMedia?.('(pointer: coarse)').matches) return;
  document.documentElement.dataset.touch = '';
  const thumb = document.createElement('div');
  thumb.className = 'touch-scroll-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  document.body.appendChild(thumb);

  const lastTop = new WeakMap<Element, number>();
  let hide = 0;
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      // Sideways scrolling (a row of chips, a code block) leaves it alone.
      if (lastTop.get(el) === el.scrollTop) return;
      lastTop.set(el, el.scrollTop);
      const range = el.scrollHeight - el.clientHeight;
      const r = el.getBoundingClientRect();
      const track = r.height - THUMB - PAD * 2;
      if (range < 1 || track < THUMB) return;
      const at = Math.min(1, Math.max(0, Math.abs(el.scrollTop) / range));
      thumb.style.transform = `translate(${r.right - 7}px, ${r.top + PAD + at * track}px)`;
      thumb.style.opacity = '1';
      window.clearTimeout(hide);
      hide = window.setTimeout(() => (thumb.style.opacity = '0'), 800);
    },
    { capture: true, passive: true }
  );
}
