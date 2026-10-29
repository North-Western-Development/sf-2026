/**
 * The on-screen keyboard, like Discord: the app shrinks to the space above it, so the header
 * stays put and the composer sits on the keyboard. Chrome on Android does that from the
 * viewport meta tag (interactive-widget=resizes-content, index.html). Safari and older browsers
 * keep the page full height and scroll it up instead, so on touch screens the app is sized to
 * the visible area (--app-height, index.css) and the page is kept from scrolling.
 */
export function trackVisualViewport() {
  const vv = window.visualViewport;
  if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
  const root = document.documentElement;
  const update = () => {
    // Pinch-zoomed in, the visible area is not the app's size: leave the layout alone.
    if (vv.scale > 1.01) {
      root.style.removeProperty('--app-height');
      return;
    }
    root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
