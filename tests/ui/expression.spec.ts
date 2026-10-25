import { test, expect, register, signIn } from './fixtures';
import { PNG } from '../support/mock-drives';

test.describe('Stickers and GIFs', () => {
  test('an admin adds a sticker that is sent from the sticker picker, and GIFs are searched, starred and sent', async ({ page }) => {
    const me = await register('stickers', 'Sticker Pilot');
    const { beacon, relays } = await me.api.createBeacon('Sticker Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);

    // Beacon Settings › Stickers: upload one.
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Sticker Beacon' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Beacon Settings' }).click();
    await page.getByRole('menuitem', { name: 'Stickers' }).click();
    const settings = page.getByRole('dialog', { name: /Settings/ });
    const chooser = page.waitForEvent('filechooser');
    await settings.getByRole('button', { name: 'Choose sticker image' }).click();
    await (await chooser).setFiles({ name: 'wave.png', mimeType: 'image/png', buffer: PNG });
    await settings.getByRole('textbox', { name: 'Sticker name' }).fill('Hello There');
    await settings.getByRole('button', { name: 'Related emoji' }).click();
    await page.getByRole('dialog', { name: 'Emoji picker' }).getByRole('textbox', { name: 'Search emoji' }).fill('wave');
    await page.getByRole('dialog', { name: 'Emoji picker' }).getByRole('button', { name: 'wave', exact: true }).click();
    await settings.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(settings.getByRole('button', { name: 'Delete sticker Hello There' })).toBeAttached();
    await page.keyboard.press('Escape');

    // The composer's sticker button sends it on its own.
    await page.getByRole('button', { name: 'Open sticker picker' }).click();
    await page.getByRole('dialog', { name: 'Emoji picker' }).getByRole('button', { name: 'Sticker Hello There' }).click();
    await expect(page.getByRole('log').getByRole('img', { name: 'Sticker Hello There' })).toBeVisible();

    // GIFs: search (a mock GIPHY in the test stack), star one, send one.
    await page.getByRole('button', { name: 'Open GIF picker' }).click();
    const picker = page.getByRole('dialog', { name: 'Emoji picker' });
    await expect(picker.getByRole('tab', { name: 'GIFs' })).toHaveAttribute('aria-selected', 'true');
    await picker.getByRole('textbox', { name: 'Search GIFs' }).fill('party');
    const party = picker.getByRole('button', { name: 'GIF party party' });
    await party.hover();
    await picker.getByRole('button', { name: 'Add to favorites' }).first().click();
    await party.click();
    await expect.poll(async () => (await me.api.get(`/channels/relay/${general.id}/transmissions?limit=1`)).transmissions[0]?.content).toContain('/giphy/gif.gif');
    // Only the GIF shows, not its link.
    const last = page.getByRole('log').getByRole('article').last();
    await expect(last.locator('img').first()).toBeVisible();
    await expect(last).not.toContainText('giphy');

    // The favorite is kept.
    await page.getByRole('button', { name: 'Open GIF picker' }).click();
    await picker.getByRole('button', { name: 'Favorites' }).click();
    await expect(picker.getByRole('button', { name: 'Remove from favorites' })).toHaveCount(1);
  });
});
