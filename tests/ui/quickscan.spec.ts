import { test, expect, register, signIn } from './fixtures';

test.describe('Quick Scan (Ctrl+K)', () => {
  test('finds relays in beacons not opened this session, and goes there', async ({ page }) => {
    const me = await register('scan', 'Scan Pilot');
    const { beacon: home, relays: homeRelays } = await me.api.createBeacon('Scan Home');
    const { beacon: far } = await me.api.createBeacon('Far Station');
    const hangar = (await me.api.post(`/beacons/${far.id}/relays`, { name: 'hangar-bay', type: 'text' })).relay;

    // Only Scan Home is opened, so Far Station's relays were never loaded.
    await signIn(page, me, `/channels/${home.id}/${homeRelays.find((r) => r.type === 'text')!.id}`);
    await page.keyboard.press('Control+k');
    const input = page.getByRole('textbox', { name: 'Quick Scan' });
    await input.fill('hangar');
    const option = page.getByRole('option').filter({ hasText: 'hangar-bay' });
    await expect(option).toContainText('Far Station');
    await option.click();
    await expect(page).toHaveURL(new RegExp(`/channels/${far.id}/${hangar.id}`));

    // "#" narrows to relays, still across every beacon.
    await page.keyboard.press('Control+k');
    await page.getByRole('textbox', { name: 'Quick Scan' }).fill('#gene');
    await expect(page.getByRole('option').filter({ hasText: 'Scan Home' }).first()).toBeVisible();
    await expect(page.getByRole('option').filter({ hasText: 'Far Station' }).first()).toBeVisible();
  });
});
