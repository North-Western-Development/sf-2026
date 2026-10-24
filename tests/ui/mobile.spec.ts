import { test, expect, register, signIn } from './fixtures';

// Phone width: what the mobile app's WebView shows.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.describe('Phone layout', () => {
  test('the sidebar is a drawer that closes when a relay is picked', async ({ page }) => {
    const me = await register('phone', 'Phone Pilot');
    const { beacon, relays } = await me.api.createBeacon('Pocket Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await me.api.send(general.id, 'Hello from a phone-sized screen');
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`, { shell: false });

    const log = page.getByRole('log');
    await expect(log).toContainText('Hello from a phone-sized screen');
    // The message list gets the full width while the drawer is closed.
    expect((await log.boundingBox())!.width).toBeGreaterThan(350);
    await expect(page.getByRole('navigation', { name: 'Relays' })).not.toBeInViewport();

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const relaysNav = page.getByRole('navigation', { name: 'Relays' });
    await expect(relaysNav).toBeInViewport();
    await relaysNav.getByRole('link', { name: /general/ }).click();
    await expect(relaysNav).not.toBeInViewport();
  });

  test('settings show the section list, then a page with a back button', async ({ page }) => {
    const me = await register('phoneset', 'Phone Settings');
    await signIn(page, me, '/channels/@me', { shell: false });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'User Settings' }).click();

    const dialog = page.getByRole('dialog');
    const sections = dialog.getByRole('navigation', { name: /sections/ });
    await expect(sections).toBeVisible();
    await sections.getByRole('button', { name: 'Profiles', exact: true }).click();
    await expect(sections).toBeHidden();
    await expect(dialog.getByRole('heading', { name: 'Profiles' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Back to settings' }).click();
    await expect(sections).toBeVisible();
    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).toHaveCount(0);
  });
});
