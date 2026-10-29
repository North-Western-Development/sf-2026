import { test, expect, register, signIn } from './fixtures';
import type { Locator, Page } from '@playwright/test';

// Phone width with touch: what the mobile app's WebView shows.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/** A one-finger horizontal swipe, as real touch events (the app listens for those, not clicks). */
async function swipe(page: Page, from: { x: number; y: number }, dx: number) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 10;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (dx * i) / steps, y: from.y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function centre(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function openRelay(page: Page, prefix: string, lines: string[] = []) {
  const me = await register(prefix, 'Swipe Pilot');
  const { beacon, relays } = await me.api.createBeacon('Thumb Beacon');
  const general = relays.find((r) => r.type === 'text')!;
  for (const line of lines) await me.api.send(general.id, line);
  await signIn(page, me, `/channels/${beacon.id}/${general.id}`, { shell: false });
  return { me, beacon, general };
}

test.describe('Phone gestures and the attach sheet', () => {
  test('swiping a transmission left replies to it and brings the keyboard up', async ({ page }) => {
    await openRelay(page, 'swipereply', ['reply to me please']);
    const message = page.getByRole('log').getByRole('article').filter({ hasText: 'reply to me please' });
    await expect(message).toBeVisible();
    // A short swipe snaps back and does nothing.
    await swipe(page, await centre(message), -30);
    await expect(page.getByText('Replying to')).toHaveCount(0);
    await swipe(page, await centre(message), -120);
    await expect(page.getByText('Replying to')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Transmit to #/ })).toBeFocused();
    // It slides back into place.
    await expect.poll(() => message.evaluate((el) => (el as HTMLElement).style.transform)).toBe('');
  });

  test('swiping right opens the drawer and closes the keyboard; swiping left closes it', async ({ page }) => {
    await openRelay(page, 'swipenav', ['some talk']);
    const composer = page.getByRole('textbox', { name: /^Transmit to #/ });
    await composer.click();
    await expect(composer).toBeFocused();
    const relaysNav = page.getByRole('navigation', { name: 'Relays' });
    await expect(relaysNav).not.toBeInViewport();

    // A small swipe is not enough.
    await swipe(page, { x: 60, y: 400 }, 40);
    await expect(relaysNav).not.toBeInViewport();
    await swipe(page, { x: 60, y: 400 }, 200);
    await expect(relaysNav).toBeInViewport();
    // The keyboard is never up while the drawer is out.
    await expect(composer).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    await swipe(page, { x: 250, y: 400 }, -200);
    await expect(relaysNav).not.toBeInViewport();
  });

  test('+ opens the sheet: Files attaches, Apps lists commands, Poll opens the full-screen poll', async ({ page }) => {
    await openRelay(page, 'sheet');
    const plus = page.getByRole('button', { name: 'Add attachment' });
    const composer = page.getByRole('textbox', { name: /^Transmit to #/ });
    await plus.click();
    const sheet = page.getByRole('dialog', { name: 'Attach' });
    await expect(sheet).toBeVisible();
    const tabs = sheet.getByRole('navigation', { name: 'Attach from' });
    for (const name of ['Photos', 'Poll', 'Apps', 'Files']) await expect(tabs.getByText(name, { exact: true })).toBeVisible();
    await expect(sheet.getByText('Camera')).toBeVisible();
    // The tab bar sits at the bottom of the screen; the tiles do not scroll.
    const bar = (await tabs.boundingBox())!;
    expect(844 - (bar.y + bar.height)).toBeLessThanOrEqual(16);
    expect(await sheet.evaluate((el) => [...el.querySelectorAll('*')].some((c) => c.scrollHeight > c.clientHeight + 1 && getComputedStyle(c).overflowY !== 'visible'))).toBe(false);
    // The sheet sits where the keyboard would, under the composer.
    expect((await sheet.boundingBox())!.y).toBeGreaterThan((await composer.boundingBox())!.y);

    // Files: the picked file is attached and the sheet goes.
    await tabs.getByLabel('Files').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(sheet).toHaveCount(0);
    await page.getByRole('dialog', { name: 'Before you upload' }).getByRole('button', { name: 'I understand' }).click();
    await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();

    // Apps: a searchable list of slash commands; picking one puts it in the box.
    await plus.click();
    await page.getByRole('navigation', { name: 'Attach from' }).getByRole('button', { name: 'Apps' }).click();
    const apps = page.getByRole('dialog', { name: 'Apps & Commands' });
    await apps.getByRole('textbox', { name: 'Search Apps & Commands' }).fill('shru');
    await expect(apps.getByRole('list', { name: 'Commands' }).getByRole('button')).toHaveCount(1);
    await apps.getByRole('button', { name: /\/shrug/ }).click();
    await expect(apps).toHaveCount(0);
    await expect(composer).toHaveText('/shrug ');
    await page.getByRole('button', { name: 'Remove notes.txt' }).click();
    await composer.fill('');

    // Poll: full screen, with Post across the top.
    await plus.click();
    await page.getByRole('navigation', { name: 'Attach from' }).getByRole('button', { name: 'Poll' }).click();
    const poll = page.getByRole('dialog', { name: 'Create a Poll' });
    const box = (await poll.boundingBox())!;
    expect(box.width).toBe(390);
    expect(box.height).toBeGreaterThan(800);
    const post = poll.getByRole('button', { name: 'Post' });
    await expect(post).toBeDisabled();
    await poll.getByRole('textbox', { name: 'Question' }).fill('Pizza or tacos?');
    await poll.getByRole('textbox', { name: 'Answer 1' }).fill('Pizza');
    await poll.getByRole('textbox', { name: 'Answer 2' }).fill('Tacos');
    await poll.getByRole('checkbox', { name: 'Allow Multiple Answers' }).check();
    await post.click();
    await expect(poll).toHaveCount(0);
    await expect(page.getByRole('log')).toContainText('Pizza or tacos?');
  });

  test('the mobile app opens on the last conversation; a browser still shows the homepage', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).subspaceNative = { platform: 'android', push: null, post: () => {} };
    });
    const { general } = await openRelay(page, 'lastopen', ['where I left off']);
    await expect(page.getByRole('log')).toContainText('where I left off');
    const where = new URL(page.url()).pathname;
    expect(where).toContain(general.id);

    // Opened again from cold: the app loads the instance's root.
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${where}$`));
    await expect(page.getByRole('log')).toContainText('where I left off');

    const browserTab = await page.context().newPage();
    await browserTab.goto('/');
    await expect(browserTab.getByRole('link', { name: 'Subspace Frequency home' })).toBeVisible();
    await expect(browserTab).toHaveURL(/:4173\/$/);
    await browserTab.close();
  });

  test('picking a beacon in the drawer opens its relay without bringing the keyboard up', async ({ page }) => {
    const { me } = await openRelay(page, 'nokeys');
    const other = await me.api.createBeacon('Second Beacon');
    await page.reload();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: /^Second Beacon/ }).click();
    await expect(page).toHaveURL(new RegExp(`/channels/${other.beacon.id}/`));
    // The drawer stays out over the new relay, and nothing behind it has focus.
    await expect(page.getByRole('navigation', { name: 'Relays' })).toBeInViewport();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(false);
  });

  test('the closed drawer leaves no edge, and the composer icons line up', async ({ page }) => {
    await openRelay(page, 'edges');
    const edge = await page.evaluate(() => {
      const drawer = document.querySelector('nav[aria-label="Beacons"]')!.closest('.fixed') as HTMLElement;
      return getComputedStyle(drawer).boxShadow;
    });
    // No shadow (its 1px ring was the strip down the left edge).
    expect(edge).toMatch(/^(none|(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+)$/);
    const mid = async (name: string) => {
      const b = (await page.getByRole('button', { name }).boundingBox())!;
      return b.y + b.height / 2;
    };
    expect(Math.abs((await mid('Record a voice message')) - (await mid('Select emoji')))).toBeLessThan(1);
  });

  test('scrolling shows one thin thumb of a fixed length instead of the scrollbar', async ({ page }) => {
    const lines = Array.from({ length: 40 }, (_, i) => `scroll line ${i}`);
    await openRelay(page, 'thumb', lines);
    const log = page.getByRole('log');
    await expect(log).toContainText('scroll line 39');
    // No native scrollbar takes width.
    expect(await log.evaluate((el) => el.offsetWidth - el.clientWidth)).toBe(0);
    const thumb = page.locator('.touch-scroll-thumb');
    const height = () => thumb.evaluate((el) => el.getBoundingClientRect().height);
    await log.evaluate((el) => (el.scrollTop = 0));
    await expect(thumb).toHaveCSS('opacity', '1');
    const atTop = (await thumb.boundingBox())!.y;
    const h = await height();
    await log.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect.poll(async () => (await thumb.boundingBox())!.y).toBeGreaterThan(atTop + 300);
    expect(await height()).toBe(h);
    // It fades once scrolling stops.
    await expect(thumb).toHaveCSS('opacity', '0');
  });

  test('the affiliate tabs all fit on a phone', async ({ page }) => {
    const me = await register('tabsfit', 'Tab Pilot');
    await signIn(page, me, '/channels/@me', { shell: false });
    const tabs = page.getByRole('navigation', { name: /filters/ });
    for (const name of ['Online', 'All', 'Pending', 'Blocked', /^Add/]) await expect(tabs.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
  });
});
