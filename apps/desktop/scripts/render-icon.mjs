// Render the 1024x1024 app icon (the NWD pixel star on deep black) with Playwright's Chromium.
// `tauri icon app-icon.png` then makes every platform size from it.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../app-icon.png', import.meta.url));
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:1024px;height:1024px;border-radius:224px;background:radial-gradient(70% 70% at 50% 35%,#131a33,#030305 70%);display:grid;place-items:center">
<svg width="700" height="700" viewBox="-0.5 -0.5 10 10" shape-rendering="crispEdges">
<defs><radialGradient id="g" cx="50%" cy="50%" r="55%"><stop offset="0%" stop-color="#FFFDE8"/><stop offset="18%" stop-color="#FFFDE8"/><stop offset="55%" stop-color="#FFF36B"/><stop offset="100%" stop-color="#FFF36B"/></radialGradient></defs>
<path d="M4 0h1v2h1v1h1v1h2v1h-2v1h-1v1h-1v2h-1v-2h-1v-1h-1v-1h-2v-1h2v-1h1v-1h1z" fill="url(#g)" stroke="#5A5C8E" stroke-width="0.35" stroke-linejoin="round"/>
</svg></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(html);
await page.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(`Wrote ${out}`);
