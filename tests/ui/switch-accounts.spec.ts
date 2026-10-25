import { test, expect, register, signIn, PASSWORD } from './fixtures';

test('adds a second account, switches between them, and logging out falls back to the other', async ({ page }) => {
  const first = await register('switcha', 'First Pilot');
  const second = await register('switchb', 'Second Pilot');
  await signIn(page, first);

  const openSwitcher = async () => {
    await page.getByRole('button', { name: 'Open your profile' }).click();
    await page.getByRole('dialog', { name: 'Your profile' }).getByRole('button', { name: 'Switch Accounts' }).click();
    return page.getByRole('dialog', { name: 'Manage Accounts' });
  };

  // Add the second account: the first stays signed in.
  await (await openSwitcher()).getByRole('button', { name: 'Add an Account' }).click();
  await page.getByLabel('Email or tag').fill(second.transmitter.email!);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open your profile' })).toContainText('Second Pilot');

  // Switch back without a password.
  const switcher = await openSwitcher();
  await expect(switcher.getByRole('listitem')).toHaveCount(2);
  await switcher.getByRole('button', { name: 'Switch to First Pilot' }).click();
  await expect(page.getByRole('button', { name: 'Open your profile' })).toContainText('First Pilot');

  // Logging out of this one lands in the other.
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Log Out' }).click();
  await page.getByRole('dialog', { name: 'Log Out' }).getByRole('button', { name: 'Log Out' }).click();
  await expect(page.getByRole('button', { name: 'Open your profile' })).toContainText('Second Pilot');
  await expect((await openSwitcher()).getByRole('listitem')).toHaveCount(1);
});
