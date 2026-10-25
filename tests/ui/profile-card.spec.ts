import { test, expect, register, signIn, promoteToStaff } from './fixtures';

const SHOTS = process.env.PROFILE_SHOTS ? 'screenshots/' : null;

test.describe('Profile card, popout and badges', () => {
  test('the user panel opens the account card: status bubble, badges, presence flyout, badge browser', async ({ page }) => {
    const me = await register('carder', 'Card Pilot');
    await promoteToStaff(me, 3);
    await me.api.patch('/users/@me/profile', { pronouns: 'they/them', customStatus: { text: 'Charting the outer rim' } });
    // Ten transmissions earn the first level of the Transmissions badge.
    const { relays } = await me.api.createBeacon('Badge Beacon');
    const text = relays.find((r) => r.type === 'text')!;
    for (let i = 0; i < 10; i++) await me.api.send(text.id, `ping ${i}`);
    await signIn(page, me, '/channels/@me');

    await page.getByRole('button', { name: 'Open your profile' }).click();
    const card = page.getByRole('dialog', { name: 'Your profile' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Edit custom status' })).toContainText('Charting the outer rim');
    await expect(card).toContainText('they/them');
    // Badges are awarded when the profile loads.
    const badges = card.getByRole('list', { name: 'Badges' });
    await expect(badges.getByRole('listitem', { name: 'Subspace Command Staff' })).toBeVisible();
    await expect(badges.getByRole('listitem', { name: 'Early Transmitter' })).toBeVisible();
    await expect(badges.getByRole('listitem', { name: 'Ping' })).toBeVisible();
    // Discord's extras without a backend are greyed placeholders; Member Since is not on the card.
    await expect(card.locator('[data-coming-soon]')).toHaveCount(3);
    await expect(card).not.toContainText('Member Since');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}card-self.png` });

    // Presence flyout.
    await card.getByRole('button', { name: 'Status: Online' }).click();
    await page.getByRole('menuitem', { name: /Do Not Disturb/ }).click();
    await expect(card.getByRole('button', { name: 'Status: Do Not Disturb' })).toBeVisible();

    // Badge browser: what you have, then only the badges activity can unlock.
    await card.getByRole('button', { name: 'Badges' }).click();
    const dialog = page.getByRole('dialog', { name: 'Badges' });
    const yours = dialog.getByRole('list', { name: 'Your badges' });
    const available = dialog.getByRole('list', { name: 'Available to unlock' });
    await expect(yours.getByRole('listitem', { name: 'Subspace Command Staff' })).toBeVisible();
    await expect(yours.getByRole('listitem', { name: 'Early Transmitter' })).toBeVisible();
    await expect(yours.getByRole('listitem', { name: 'Ping' })).toBeVisible();
    await expect(available.getByRole('listitem', { name: 'Static' })).toBeVisible();
    await expect(available.getByRole('listitem', { name: 'One Orbit' })).toBeVisible();
    await expect(available.getByRole('listitem')).toHaveCount(2);

    // A levelled badge shows progress to the next level and the whole ladder.
    await yours.getByRole('listitem', { name: 'Ping' }).click();
    await expect(dialog.getByRole('progressbar', { name: 'Progress to Chatter' })).toBeVisible();
    await expect(dialog).toContainText('90 more transmissions');
    await expect(dialog.getByRole('list', { name: 'Levels' }).getByRole('listitem')).toHaveCount(6);
    await expect(dialog.getByRole('listitem', { name: 'Megaphone, locked' })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}card-badges.png` });

    // Customize: the staff badge cannot be hidden; hiding another removes it from the profile.
    await dialog.getByRole('button', { name: 'Customize Your Badges' }).click();
    await expect(dialog.getByRole('switch', { name: 'Subspace Command Staff' })).toBeDisabled();
    await dialog.getByRole('switch', { name: 'Early Transmitter' }).click();
    await expect(dialog.getByRole('switch', { name: 'Early Transmitter' })).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open your profile' }).click();
    const again = page.getByRole('dialog', { name: 'Your profile' }).getByRole('list', { name: 'Badges' });
    await expect(again.getByRole('listitem', { name: 'Ping' })).toBeVisible();
    await expect(again.getByRole('listitem', { name: 'Early Transmitter' })).toHaveCount(0);
  });

  test('Member Since shows only on the full profile, as the Subspace and beacon icons with dates', async ({ page }) => {
    const me = await register('since', 'Since Pilot');
    const other = await register('sinceo', 'Since Other');
    const { beacon, relays } = await me.api.createBeacon('Since Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await other.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);
    await other.api.patch('/users/@me/profile', { customStatus: { text: 'Out past Saturn' } });
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);

    await page.getByRole('complementary', { name: 'Members' }).getByRole('button', { name: /Since Other/ }).click();
    const popout = page.getByRole('dialog', { name: 'Since Other profile' });
    await expect(popout.getByLabel('Custom status')).toContainText('Out past Saturn');
    await expect(popout.getByRole('listitem', { name: 'Early Transmitter' })).toBeVisible();
    await expect(popout).not.toContainText('Member Since');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}card-popout.png` });

    await popout.getByRole('button', { name: 'View Full Profile' }).click();
    const full = page.getByRole('dialog').filter({ hasText: 'Member Since' });
    await expect(full.getByRole('img', { name: 'Subspace Frequency' })).toBeVisible();
    await expect(full.getByRole('img', { name: 'Since Beacon' })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}card-full-profile.png` });
  });
});
