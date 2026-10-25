import { test, expect, register, signIn } from './fixtures';

test.describe('Display, accessibility, language and safety settings', () => {
  test('compact mode, saturation, link underlines and a 24-hour clock apply right away', async ({ page }) => {
    const me = await register('display', 'Display Pilot');
    const { beacon, relays } = await me.api.createBeacon('Display Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await me.api.send(general.id, 'compact me https://example.invalid');
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
    const msg = page.getByRole('article').filter({ hasText: 'compact me' });
    await expect(msg.getByRole('button', { name: 'Open profile' })).toHaveCount(1);

    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('radio', { name: /Compact/ }).click();
    await page.getByRole('button', { name: 'Accessibility', exact: true }).click();
    await page.getByRole('slider', { name: 'Saturation' }).fill('40');
    await page.getByRole('switch', { name: 'Always underline links' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.filter)).toBe('saturate(0.4)');
    await page.getByRole('button', { name: 'Language & Time', exact: true }).click();
    await page.getByRole('radio', { name: /24-hour clock/ }).click();
    await expect(page.getByTestId('time-preview')).not.toContainText(/AM|PM/);
    await page.keyboard.press('Escape');

    // Compact: no avatar, the name sits on the line; links are underlined.
    await expect(msg.getByRole('button', { name: 'Open profile' })).toHaveCount(0);
    await expect(msg.getByRole('button', { name: 'Display Pilot' })).toBeVisible();
    await expect(msg.getByRole('link')).toHaveCSS('text-decoration-line', 'underline');
    await expect(msg.locator('time')).not.toContainText(/AM|PM/);
  });

  test('DMs from beacon members default off for new beacons, and explicit images blur until clicked', async ({ page }) => {
    const me = await register('safety', 'Safety Pilot');
    const other = await register('safetyother', 'Safety Other');
    const { beacon } = await other.api.createBeacon('Safety Beacon');
    const { beacon: later } = await other.api.createBeacon('Later Beacon');
    await me.api.join(beacon.id, (await other.api.createInvite(beacon.id)).code);

    // A non-affiliate's image link in a DM (DMs from others blur by default).
    const { link } = await me.api.post('/links', { targetId: other.transmitter.id });
    await other.api.post(`/channels/link/${link.id}/transmissions`, { content: 'http://127.0.0.1:4195/giphy/gif.gif?n=blur' });

    // A stand-in classifier: every image is "explicit" (the real one runs nsfwjs on this device).
    await page.addInitScript(() => ((window as any).__subspaceClassify = () => true));
    await signIn(page, me, `/channels/@me/${link.id}`);
    const cover = page.getByRole('button', { name: 'Explicit content. Click to show.' });
    await expect(cover).toBeVisible({ timeout: 15_000 });
    await cover.click();
    await expect(cover).toHaveCount(0);

    // Turning off DMs from beacon members, for new beacons only.
    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Data & Privacy', exact: true }).click();
    await page.getByRole('switch', { name: /Allow direct links from other members/ }).click();
    await page.getByRole('dialog', { name: 'Apply to existing beacons?' }).getByRole('button', { name: 'Only New Ones' }).click();
    await expect.poll(async () => (await me.api.get('/auth/me')).transmitter.defaultAllowDms).toBe(false);
    expect((await me.api.get(`/beacons/${beacon.id}/members/@me/privacy`)).privacy.allowDms).toBe(true);
    await me.api.join(later.id, (await other.api.createInvite(later.id)).code);
    expect((await me.api.get(`/beacons/${later.id}/members/@me/privacy`)).privacy.allowDms).toBe(false);
  });
});
