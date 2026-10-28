import { test, expect, signIn } from './fixtures';

// Guards for layout that already matches Discord; these broke once in a refactor.
test.describe('Shell layout', () => {
  test('the user island spans the beacon rail and the sidebar, pinned to the bottom', async ({ page, me }) => {
    await signIn(page, me);
    const rail = await page.getByRole('navigation', { name: 'Beacons' }).boundingBox();
    const island = await page.getByRole('button', { name: 'Open your profile' }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').boundingBox();
    const sidebar = await page.locator('aside').first().boundingBox();
    const viewport = page.viewportSize()!;
    expect(rail && island && sidebar).toBeTruthy();
    // Starts inside the rail column and ends at the sidebar's right edge.
    expect(island!.x).toBeLessThan(rail!.x + rail!.width);
    expect(island!.x + island!.width).toBeGreaterThan(sidebar!.x + sidebar!.width - 16);
    expect(island!.x + island!.width).toBeLessThanOrEqual(sidebar!.x + sidebar!.width);
    // Sits at the bottom of the window.
    expect(viewport.height - (island!.y + island!.height)).toBeLessThan(16);
  });

  test('user settings open as a windowed modal, not a full-screen page', async ({ page, me }) => {
    await signIn(page, me);
    await page.getByRole('button', { name: 'User Settings' }).click();
    const nav = page.getByRole('navigation', { name: /User Settings sections/ });
    await expect(nav).toBeVisible();
    const panel = await page.getByRole('dialog', { name: 'User Settings' }).boundingBox();
    const viewport = page.viewportSize()!;
    expect(panel).toBeTruthy();
    expect(panel!.width).toBeLessThan(viewport.width - 40);
    expect(panel!.height).toBeLessThan(viewport.height - 20);
    expect(panel!.x).toBeGreaterThan(10);

    // Escape closes it; the app behind is still there.
    await page.keyboard.press('Escape');
    await expect(nav).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
  });

  test('the browser context menu never appears; ours does', async ({ page, me }) => {
    const { beacon, relays } = await me.api.createBeacon('Menu Beacon');
    const relay = relays.find((r) => r.type === 'text')!;
    await me.api.send(relay.id, 'right click me');
    await signIn(page, me, `/channels/${beacon.id}/${relay.id}`);

    const targets = [
      page.getByRole('article').filter({ hasText: 'right click me' }),
      page.getByRole('textbox', { name: /^Transmit to #/ }),
      page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Menu Beacon' }),
      page.getByRole('heading', { name: /^Welcome to #/ }),
      page.locator('main'),
    ];
    for (const target of targets) {
      const prevented = await target.first().evaluate((el) => {
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
        el.dispatchEvent(ev);
        return ev.defaultPrevented;
      });
      expect(prevented).toBe(true);
      await page.keyboard.press('Escape');
    }

    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Menu Beacon' }).click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Invite to Beacon' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('features still to come are greyed placeholders with a Coming soon tooltip', async ({ page, me }) => {
    // Themes are the one placeholder left (Settings › Appearance).
    await signIn(page, me);
    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    const placeholders = page.locator('[data-coming-soon]');
    await expect(placeholders.first()).toBeVisible();
    const first = placeholders.first();
    await expect(first).toHaveAttribute('aria-disabled', 'true');
    await first.hover();
    await expect(page.getByRole('tooltip')).toContainText('Coming soon');
  });

  test('modals share one look: centred, dimmed backdrop, Escape closes', async ({ page, me }) => {
    await signIn(page, me);
    await page.getByRole('button', { name: 'Add a Beacon' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Your Beacon' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(4);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('no horizontal scroll at a small laptop size', async ({ page, me }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await signIn(page, me);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test('the AMOLED theme turns surfaces true black with the deeper NWD cobalt, and sticks after a reload', async ({ page, me }) => {
  await signIn(page, me);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(3, 3, 5)');
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const themes = page.getByRole('radiogroup', { name: 'Theme' });
  await expect(themes.getByRole('radio', { name: 'Deep Space' })).toHaveAttribute('aria-checked', 'true');
  await themes.getByRole('radio', { name: 'AMOLED' }).click();
  await expect(themes.getByRole('radio', { name: 'AMOLED' })).toHaveAttribute('aria-checked', 'true');
  expect(await bg()).toBe('rgb(0, 0, 0)');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim().toLowerCase())).toBe('#3353d6');
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('amoled');
  expect(await bg()).toBe('rgb(0, 0, 0)');
});
