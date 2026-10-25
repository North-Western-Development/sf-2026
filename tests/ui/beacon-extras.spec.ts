import { test, expect, register, signIn } from './fixtures';

test.describe('Beacon extras', () => {
  test('creates a beacon from a starter template', async ({ page }) => {
    const me = await register('tplui', 'Template Pilot');
    await signIn(page, me);
    await page.getByRole('button', { name: 'Add a Beacon' }).click();
    await page.getByRole('button', { name: 'Gaming' }).click();
    await page.getByRole('textbox', { name: /Beacon name/i }).fill('Frag Squad');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const relays = page.getByRole('navigation', { name: 'Relays' });
    await expect(relays.getByRole('link', { name: /^clips-and-highlights/ })).toBeVisible();
    await expect(relays.getByRole('link', { name: /^Lobby/ })).toBeVisible();
  });

  test('a beacon tag shows beside names, insights render, the template link builds a copy, and the widget works signed out', async ({ page, browser }) => {
    const owner = await register('tagowner', 'Tag Owner');
    const { beacon, relays } = await owner.api.createBeacon('Tagged Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await owner.api.patch(`/beacons/${beacon.id}`, { tag: 'TAG', tagBadge: '🚀', widgetEnabled: true, widgetChannelId: general.id });
    await owner.api.put('/users/@me/tag', { beaconId: beacon.id });
    await owner.api.send(general.id, 'wearing my tag');
    const { template } = await owner.api.post(`/beacons/${beacon.id}/template`, { name: 'Tagged Layout' });

    await signIn(page, owner, `/channels/${beacon.id}/${general.id}`);
    const msg = page.getByRole('article').filter({ hasText: 'wearing my tag' });
    await expect(msg.getByLabel(/Beacon tag TAG/)).toBeVisible();

    // Insights.
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Tagged Beacon' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Beacon Settings' }).click();
    await page.getByRole('menuitem', { name: 'Beacon Profile', exact: true }).click();
    const settings = page.getByRole('dialog', { name: /Settings/ });
    await settings.getByRole('button', { name: 'Beacon Insights' }).click();
    await expect(settings.getByRole('img', { name: /Transmissions per day/ })).toBeVisible();
    await expect(settings.getByRole('table', { name: /Most active/ })).toContainText('#general');
    await page.keyboard.press('Escape');

    // The template link makes a copy.
    await page.goto(`/template/${template.code}`);
    await expect(page.getByRole('heading', { name: 'Tagged Layout' })).toBeVisible();
    await page.getByRole('button', { name: 'Create Beacon' }).click();
    await expect(page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: /Tagged Layout/ })).toBeVisible();

    // The widget, in a signed-out browser.
    const outside = await browser.newContext();
    const widget = await outside.newPage();
    await widget.goto(`/widget/${beacon.id}`);
    await expect(widget.getByRole('banner')).toContainText('Tagged Beacon');
    await expect(widget.getByRole('link', { name: 'Join Tagged Beacon' })).toHaveAttribute('href', /\/invite\//);
    await outside.close();
  });
});
