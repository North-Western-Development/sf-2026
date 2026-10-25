import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, register, signIn, openAs } from './fixtures';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

// A fake website on localhost (the test stack allows previews of localhost only).
let site: http.Server;
let origin = '';
test.beforeAll(async () => {
  site = http.createServer((req, res) => {
    if (req.url?.startsWith('/article')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(
        '<html><head><meta property="og:title" content="Nebula Field Guide"><meta property="og:description" content="Everything about gas clouds."><meta property="og:site_name" content="Star Atlas"><meta property="og:image" content="/thumb.png"><meta name="theme-color" content="#3dcbff"></head></html>'
      );
    }
    if (req.url === '/thumb.png' || req.url === '/photo.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => site.listen(0, 'localhost', r));
  origin = `http://localhost:${(site.address() as AddressInfo).port}`;
});
test.afterAll(() => site.close());

test.describe('Link previews', () => {
  test('a pasted link grows a preview for everyone, and the author can remove it', async ({ page, me, browser }) => {
    const crew = await register('crew');
    const { beacon, relays } = await me.api.createBeacon('Embed Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${general.id}`);

    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
    const composer = page.getByRole('textbox', { name: /Transmit to/ });
    await composer.fill(`check this ${origin}/article?id=1`);
    await composer.press('Enter');

    const preview = page.getByRole('article', { name: 'Link preview: Nebula Field Guide' });
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(preview).toContainText('Star Atlas');
    await expect(preview).toContainText('Everything about gas clouds.');
    // Images come through our proxy, never straight from the third-party host.
    await expect(preview.locator('img')).toHaveAttribute('src', /^\/api\/v1\/embed-proxy\?/);
    await expect.poll(() => preview.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

    // The other member gets it live.
    const theirPreview = theirs.getByRole('article', { name: 'Link preview: Nebula Field Guide' });
    await expect(theirPreview).toBeVisible();
    await theirPreview.hover();
    await expect(theirPreview.getByRole('button', { name: 'Remove all embeds' })).toHaveCount(0);

    await preview.hover();
    await preview.getByRole('button', { name: 'Remove all embeds' }).click();
    await page.getByRole('dialog', { name: 'Remove Embeds' }).getByRole('button', { name: 'Remove All' }).click();
    await expect(preview).toHaveCount(0);
    await expect(theirPreview).toHaveCount(0);
    await theirs.context().close();
  });

  test('image links show the image, and the Chat setting hides previews', async ({ page, me }) => {
    const { beacon, relays } = await me.api.createBeacon('Image Links');
    const general = relays.find((r) => r.type === 'text')!;
    await me.api.send(general.id, `${origin}/photo.png`);
    await me.api.send(general.id, `<${origin}/article?id=2> no preview wanted`);

    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
    const log = page.getByRole('log');
    const photo = log.getByRole('article').locator('img[src^="/api/v1/embed-proxy"]');
    await expect(photo).toBeVisible({ timeout: 15_000 });
    await expect(log.getByRole('article', { name: /Link preview/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('switch', { name: 'Show embeds and preview website links pasted into chat' }).click();
    await page.keyboard.press('Escape');
    await expect(photo).toHaveCount(0);
    // With previews off, the link itself shows again.
    await expect(log.getByRole('link', { name: `${origin}/photo.png` })).toBeVisible();
  });
});
