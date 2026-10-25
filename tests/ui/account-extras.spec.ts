import { test, expect, register, signIn, setPhoneCode, resolvedReportAgainst, PASSWORD } from './fixtures';

test.describe('Account extras', () => {
  test('adds and removes a phone number, and shows account standing', async ({ page }) => {
    const me = await register('phone', 'Phone Pilot');
    const reporter = await register('reporter', 'Reporter');
    await resolvedReportAgainst(me, reporter, 'harassment');
    await signIn(page, me);
    await page.getByRole('button', { name: 'User Settings' }).click();

    // Account Standing reflects the resolved report.
    await page.getByRole('button', { name: /Account Standing/ }).click();
    const standing = page.getByTestId('standing');
    await expect(standing).toContainText('Your account is limited');
    await expect(standing).toContainText('Harassment');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Enter a phone number' });
    await dialog.getByLabel('Phone Number').fill('+1 555 010 0142');
    await dialog.getByLabel('Current Password').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Send Code' }).click();
    const codeDialog = page.getByRole('dialog', { name: 'Enter the code' });
    await expect(codeDialog).toBeVisible();
    await setPhoneCode(me, '424242');
    await codeDialog.getByLabel('Verification Code').fill('424242');
    await codeDialog.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('+1 ******0142')).toBeVisible();

    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    const remove = page.getByRole('dialog', { name: 'Remove phone number' });
    await remove.getByLabel('Current Password').fill(PASSWORD);
    await remove.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('+1 ******0142')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  });

  test('an avatar decoration and profile effect show in the preview, on messages and in the profile', async ({ page }) => {
    const me = await register('deco', 'Deco Pilot');
    const { beacon, relays } = await me.api.createBeacon('Deco Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await me.api.send(general.id, 'look at my orbit');
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);

    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Profiles', exact: true }).click();
    await page.getByRole('button', { name: 'Change Decoration' }).click();
    await page.getByRole('radio', { name: 'Orbit' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('button', { name: 'Change Effect' }).click();
    await page.getByRole('radio', { name: 'Aurora' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    const preview = page.getByTestId('profile-preview');
    await expect(preview.locator('[data-decoration="orbit"]')).toBeVisible();
    await expect(preview.locator('[data-profile-effect="aurora"]')).toBeAttached();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect.poll(async () => (await me.api.get('/auth/me')).transmitter.avatarDecoration).toBe('orbit');
    await page.keyboard.press('Escape');

    const msg = page.getByRole('article').filter({ hasText: 'look at my orbit' });
    await expect(msg.locator('[data-decoration="orbit"]')).toBeVisible();
    await msg.getByRole('button', { name: 'Open profile' }).click();
    await expect(page.getByRole('dialog', { name: /Deco Pilot profile/ }).locator('[data-profile-effect="aurora"]')).toBeAttached();
  });
});
