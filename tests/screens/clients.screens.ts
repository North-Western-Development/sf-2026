import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test } from '@playwright/test';

/**
 * The screens outside the web app: the desktop app's connect page and the docs site.
 * Build the docs first (pnpm --filter @subspace/docs build).
 */

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'screenshots/clients');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

/** Serves a folder; a path without an extension falls back to `<path>.html` like the docs host. */
function serve(dir: string): Promise<{ origin: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(dir, rel);
    if (!path.extname(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })));
}

test.beforeAll(() => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
});

test('desktop connect page', async ({ page }) => {
  const site = await serve(path.join(ROOT, 'apps/desktop/src'));
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(`${site.origin}/index.html`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '01-desktop-connect.png') });
  // Submitting a bad address shows the inline error.
  const input = page.locator('input').first();
  await input.fill('not a server');
  await input.press('Enter');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '02-desktop-connect-error.png') });
  site.close();
});

test('docs site', async ({ page }) => {
  const site = await serve(path.join(ROOT, 'apps/docs/.vitepress/dist'));
  await page.setViewportSize({ width: 1440, height: 900 });
  const pages: Array<[string, string]> = [
    ['/', 'docs-home'],
    ['/guide/introduction', 'docs-introduction'],
    ['/guide/clients', 'docs-clients'],
    ['/operate/deployment', 'docs-deployment'],
    ['/reference/configuration', 'docs-configuration'],
    ['/reference/roadmap', 'docs-roadmap'],
  ];
  let n = 2;
  for (const [url, name] of pages) {
    await page.goto(site.origin + url);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${site.origin}/guide/introduction`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-docs-phone.png`) });
  site.close();
});
