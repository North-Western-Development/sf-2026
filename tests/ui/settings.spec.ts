import { test, expect, signIn, openAs, register } from './fixtures';
import type { Page } from '@playwright/test';

async function openSettings(page: Page, section?: string) {
  await page.getByRole('button', { name: 'User Settings' }).click();
  if (section) await page.getByRole('navigation', { name: /User Settings sections/ }).getByRole('button', { name: section, exact: true }).click();
}

test.describe('User settings', () => {
  test('profile edits save, show in the user island and persist across reloads', async ({ page, me }) => {
    await signIn(page, me);
    await openSettings(page, 'Profiles');

    await page.getByLabel('Display Name').fill('Captain Sisko');
    await page.getByLabel('Pronouns').first().fill('he/him');
    await page.getByLabel('About Me').first().fill('Commander of **Deep Space Nine**');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Set status' })).toContainText('Captain Sisko');

    await page.reload();
    await expect(page.getByRole('button', { name: 'Set status' })).toContainText('Captain Sisko');
    await openSettings(page, 'Profiles');
    await expect(page.getByLabel('About Me').first()).toHaveValue('Commander of **Deep Space Nine**');
  });

  test('unsaved changes can be reset', async ({ page, me }) => {
    await signIn(page, me);
    await openSettings(page, 'Profiles');
    await page.getByLabel('Display Name').fill('Temporary');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByLabel('Display Name')).toHaveValue(me.transmitter.displayName);
    await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);
  });

  test('custom status shows to others in the member list', async ({ page, me, browser }) => {
    const other = await register('viewer');
    const { beacon, relays } = await me.api.createBeacon('Status Beacon');
    const relay = relays.find((r) => r.type === 'text')!;
    const { code } = await me.api.createInvite(beacon.id);
    await other.api.join(beacon.id, code);
    const theirs = await openAs(browser, other, `/channels/${beacon.id}/${relay.id}`);

    await signIn(page, me);
    await openSettings(page, 'Status');
    await page.getByLabel('Status text').fill('On the Defiant');
    await page.getByRole('button', { name: 'Save Status' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Set status' })).toContainText('On the Defiant');

    await expect(theirs.getByRole('complementary', { name: 'Members' })).toContainText('On the Defiant');
    await theirs.context().close();
  });

  test('changing the password requires the current one and a matching confirmation', async ({ page, me }) => {
    await signIn(page, me);
    await openSettings(page);
    const row = page.locator('div').filter({ has: page.getByText('Password', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last();
    await row.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Update your password' });
    await dialog.getByLabel(/^Current Password/).fill('wrong-current-password');
    await dialog.getByLabel(/^New Password/).fill('brand-new-password-9');
    await dialog.getByLabel(/^Confirm New Password/).fill('brand-new-password-9');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog.getByText(/Password does not match/)).toBeVisible();
    // A wrong password must not end the session.
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test('email is masked until revealed', async ({ page, me }) => {
    await signIn(page, me);
    await page.getByRole('button', { name: 'User Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'User Settings' });
    await expect(dialog).not.toContainText(me.transmitter.email);
    await dialog.getByRole('button', { name: 'Reveal' }).click();
    await expect(dialog).toContainText(me.transmitter.email);
  });
});
