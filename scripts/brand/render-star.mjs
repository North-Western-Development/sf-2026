// Render the pixel star (the same SVG as apps/web/src/features/auth/PixelStar.tsx) to the PNGs the
// web app and the docs use: the favicon, notification icon and docs logo. Run after changing it.
//   node scripts/brand/render-star.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const targets = ['../../apps/web/public/brand/star.png', '../../apps/docs/public/star.png'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<svg width="${SIZE}" height="${SIZE}" viewBox="-0.5 -0.5 10 10" shape-rendering="crispEdges" style="display:block">
<defs><radialGradient id="g" cx="50%" cy="50%" r="55%"><stop offset="0%" stop-color="#FFFDE8"/><stop offset="18%" stop-color="#FFFDE8"/><stop offset="55%" stop-color="#FFF36B"/><stop offset="100%" stop-color="#FFF36B"/></radialGradient></defs>
<path d="M4 0h1v2h1v1h1v1h2v1h-2v1h-1v1h-1v2h-1v-2h-1v-1h-1v-1h-2v-1h2v-1h1v-1h1z" fill="url(#g)" stroke="#5A5C8E" stroke-width="0.45" stroke-linejoin="round"/>
</svg></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await page.setContent(html);
for (const out of targets) {
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  console.log(`Wrote ${out}`);
}
await browser.close();
