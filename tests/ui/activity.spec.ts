import type { Page } from '@playwright/test';
import { test, expect, register, signIn, openAs, promoteToStaff, setApplicationIcon } from './fixtures';

/** What the desktop app hands the page (apps/desktop/src-tauri/src/activity.rs). */
async function desktopReports(page: Page, detail: unknown) {
  await page.evaluate((d) => {
    (window as any).__subspaceActivity = d;
    window.dispatchEvent(new CustomEvent('subspace:activity', { detail: d }));
  }, detail);
}

test('the desktop app finds a game, Activity Privacy decides who sees it, and Rich Presence adds detail', async ({ page, me, browser }) => {
  test.setTimeout(90_000);
  const friend = await register('gamefriend', 'Game Friend');
  await me.api.befriend(friend);
  const { linkId } = await me.api.openDm(friend, 'gg');
  const { application } = await me.api.post('/applications', { name: 'Space Racers' });

  // This window is the desktop app.
  await page.addInitScript(() => ((window as any).subspaceDesktop = true));
  await signIn(page, me);
  const theirs = await openAs(browser, friend, `/channels/@me/${linkId}`);
  const myRow = theirs.getByRole('link', { name: new RegExp(me.transmitter.displayName) }).first();

  // Sharing is off until turned on: the game is found, but nobody sees it.
  await desktopReports(page, { detected: { name: 'Counter-Strike 2', startedAt: Date.now() - 5 * 60_000 }, rpc: null });
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Activity Privacy' }).click();
  await expect(page.getByText('Playing now, not shared')).toBeVisible();
  await expect(myRow).not.toContainText('Playing');

  await page.getByRole('switch', { name: 'Share my activity' }).click();
  await expect(page.getByText('Playing now, shared')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Games on this device' })).toContainText('Counter-Strike 2');
  await expect(myRow).toContainText('Playing Counter-Strike 2');

  // The profile beside our Direct Link shows it with the time played.
  const card = theirs.getByRole('complementary', { name: 'Profile' }).getByRole('region', { name: 'Activity' });
  await expect(card).toContainText('Counter-Strike 2');
  await expect(card).toContainText('for 5m');
  // Its Steam cover, loaded through the media proxy.
  await expect(card.locator('img').first()).toHaveAttribute('src', /^\/api\/v1\/embed-proxy\?url=https%3A%2F%2Fshared\.cloudflare\.steamstatic\.com%2F.*%2F730%2Flibrary_600x900\.jpg&sig=/);

  // Rich Presence from a game: the application's name, the lines it sends, images through the proxy.
  await desktopReports(page, {
    detected: { name: 'Counter-Strike 2', startedAt: Date.now() - 5 * 60_000 },
    rpc: {
      clientId: application.id,
      activity: { details: 'Grand Prix · Lap 2', state: 'In a race', party: { size: 3, max: 8 }, largeImage: 'https://cdn.example.com/track.png', buttons: [{ label: 'Spectate', url: 'https://example.com/race/1' }] },
    },
  });
  await expect(myRow).toContainText('Playing Space Racers');
  await expect(card).toContainText('Grand Prix · Lap 2');
  await expect(card).toContainText('In a race (3 of 8)');
  await expect(card.getByRole('link', { name: 'Spectate' })).toHaveAttribute('href', 'https://example.com/race/1');
  await expect(card.locator('img').first()).toHaveAttribute('src', /^\/api\/v1\/embed-proxy\?url=https%3A%2F%2Fcdn\.example\.com%2Ftrack\.png&sig=/);

  // And on the profile card from their transmission.
  await theirs.getByRole('log').getByRole('button', { name: 'Open profile' }).first().click();
  const popoutCard = theirs.getByRole('dialog', { name: `${me.transmitter.displayName} profile` }).getByRole('region', { name: 'Activity' });
  await expect(popoutCard).toContainText('Space Racers');
  await theirs.keyboard.press('Escape');

  // The game ends: back to the detected one. Hiding that game shares nothing.
  await desktopReports(page, { detected: { name: 'Counter-Strike 2', startedAt: Date.now() - 5 * 60_000 }, rpc: null });
  await expect(myRow).toContainText('Playing Counter-Strike 2');
  await page.getByRole('list', { name: 'Games on this device' }).getByRole('listitem', { name: 'Counter-Strike 2' }).getByRole('checkbox').uncheck();
  await expect(page.getByText('Playing now, hidden')).toBeVisible();
  await expect(myRow).not.toContainText('Playing', { timeout: 5000 });

  // Shown again, then sharing turned off: gone for them straight away.
  await page.getByRole('list', { name: 'Games on this device' }).getByRole('listitem', { name: 'Counter-Strike 2' }).getByRole('checkbox').check();
  await expect(myRow).toContainText('Playing Counter-Strike 2', { timeout: 5000 });
  await page.getByRole('switch', { name: 'Share my activity' }).click();
  await expect(myRow).not.toContainText('Playing', { timeout: 5000 });
});

test('in the browser nothing is detected', async ({ page, me }) => {
  await signIn(page, me);
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Activity Privacy' }).click();
  await expect(page.getByText('Games are detected by the Subspace desktop app. In the browser nothing is checked.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download for Windows' })).toHaveAttribute('href', '/downloads/desktop/Subspace-Frequency-Setup.exe');
});

test("staff verify a game's own application, and its icon replaces the Steam cover", async ({ page, me, browser }) => {
  test.setTimeout(90_000);
  const root = await register('gameverifier', 'Game Verifier');
  await promoteToStaff(root, 3);
  const friend = await register('coverfriend', 'Cover Friend');
  await me.api.befriend(friend);
  const { linkId } = await me.api.openDm(friend, 'gg');
  await me.api.patch('/users/@me/profile', { activityVisibility: 'everyone' });
  // Valheim's developer registered an application with its own icon.
  const { application } = await friend.api.post('/applications', { name: 'Valheim' });
  const icon = `/subspace-media/app-icon/valheim-${application.id}.png`;
  await setApplicationIcon(application.id, icon);

  // Root links it in the Command Console.
  const console_ = await openAs(browser, root);
  await console_.getByRole('button', { name: 'User Settings' }).click();
  await console_.getByRole('button', { name: 'Command Console' }).click();
  await console_.getByRole('button', { name: 'Verified Games' }).click();
  const form = console_.getByRole('form', { name: 'Verify a game' });
  await form.getByLabel('Game').fill('Valheim');
  await form.getByLabel('Application ID').fill(application.id);
  await form.getByRole('button', { name: 'Verify' }).click();
  await expect(console_.getByRole('list', { name: 'Verified games' }).getByRole('listitem', { name: 'Valheim' })).toContainText(`Valheim · ${application.id}`);

  // My desktop app finds Valheim: my friend sees the developer's icon, not the Steam cover.
  await page.addInitScript(() => ((window as any).subspaceDesktop = true));
  await signIn(page, me);
  const theirs = await openAs(browser, friend, `/channels/@me/${linkId}`);
  await page.evaluate(() => {
    const d = { detected: { name: 'Valheim', startedAt: Date.now() }, rpc: null };
    (window as any).__subspaceActivity = d;
    window.dispatchEvent(new CustomEvent('subspace:activity', { detail: d }));
  });
  const card = theirs.getByRole('complementary', { name: 'Profile' }).getByRole('region', { name: 'Activity' });
  await expect(card).toContainText('Valheim');
  await expect(card.locator('img').first()).toHaveAttribute('src', icon);

  // Removed again (it is shared with the test database, so leave nothing behind).
  await console_.getByRole('list', { name: 'Verified games' }).getByRole('listitem', { name: 'Valheim' }).getByRole('button', { name: 'Remove' }).click();
  await console_.getByRole('dialog', { name: 'Remove Verification' }).getByRole('button', { name: 'Remove' }).click();
  await expect(console_.getByRole('list', { name: 'Verified games' })).toHaveCount(0);
});
