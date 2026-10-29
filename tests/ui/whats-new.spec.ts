import { test, expect, register, signIn, backdateAccount } from './fixtures';

test("What's New pops up once after an update, shows what concerns this platform, and stays in User Settings", async ({ page, browser }) => {
  const old = await register('veteran', 'Veteran');
  await backdateAccount(old, '2026-09-01T12:00:00Z');

  await signIn(page, old);
  const dialog = page.getByRole('dialog', { name: "What's New" });
  await expect(dialog).toBeVisible();
  // The first time on a platform: only the newest entry.
  const newest = dialog.getByRole('article', { name: 'Discover categories' });
  await expect(newest).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(1);
  await expect(newest.getByRole('region', { name: 'New Features' })).toContainText('Browse Discover by category');
  // News for the apps only is not for the web.
  await expect(newest).not.toContainText('A slimmer scroll bar');
  await expect(dialog).not.toContainText('Automatic updates');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await old.api.get('/auth/me')).transmitter?.changelogSeen?.web).toBe('2026-10-28g');

  // Once: not again on reload, nor in another browser.
  await page.reload();
  await expect(page.getByRole('button', { name: 'User Settings' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(dialog).toBeHidden();

  // The desktop app is its own platform: it shows there once too, with its own news.
  const desktop = await browser.newPage();
  await desktop.addInitScript(() => ((window as any).subspaceDesktop = true));
  await signIn(desktop, old);
  const desktopDialog = desktop.getByRole('dialog', { name: "What's New" });
  await expect(desktopDialog.getByRole('article', { name: 'Discover categories' })).toBeVisible();
  await expect(desktopDialog).not.toContainText('A slimmer scroll bar');
  // Every entry from User Settings, as the desktop app sees them: its own news, not the web's.
  await desktopDialog.getByRole('button', { name: 'Close' }).click();
  await desktop.getByRole('button', { name: 'User Settings' }).click();
  await desktop.getByRole('button', { name: "What's New" }).click();
  await expect(desktopDialog).toContainText('Automatic updates');
  await expect(desktopDialog).toContainText('Screenshot protection');
  await expect(desktopDialog).not.toContainText('The desktop app for Windows');
  await desktop.close();

  // Any time from User Settings, every entry for this platform.
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: "What's New" }).click();
  await expect(dialog.getByRole('article')).toHaveCount(6);
  await expect(dialog).toContainText('The desktop app for Windows');
  await expect(dialog).not.toContainText('Automatic updates');
  await expect(dialog.getByRole('article', { name: 'Activity status, Rich Presence and the desktop app' }).getByRole('region', { name: 'Bug Fixes' })).toContainText('Creating a bot');
});

test("a brand-new account is not shown What's New", async ({ page, me }) => {
  await signIn(page, me);
  await expect(page.getByRole('button', { name: 'User Settings' })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole('dialog', { name: "What's New" })).toHaveCount(0);
  // It still records the newest entry, so the next update shows only what is new.
  await expect.poll(async () => (await me.api.get('/auth/me')).transmitter?.changelogSeen?.web).toBe('2026-10-28g');
});
