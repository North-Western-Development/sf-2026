import { test, expect, register, uniqueName, PASSWORD } from './fixtures';

test.describe('Authentication', () => {
  test('registers a new account through the form and lands in the app', async ({ page }) => {
    const username = uniqueName('signup');
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel(/^Email/).fill(`${username}@ui-test.subspace`);
    await page.getByLabel(/^Display name/).fill('Signup Pilot');
    await page.getByLabel(/^Username/).fill(username);
    await expect(page.getByText(`You'll get a unique tag like ${username}#0427.`)).toBeVisible();
    await page.getByLabel(/^Password/).fill(PASSWORD);

    const submit = page.getByRole('button', { name: 'Continue' });
    await expect(submit).toBeDisabled();
    await page.getByRole('checkbox').check();
    await submit.click();

    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
    await expect(page.getByText('Signup Pilot').first()).toBeVisible();
  });

  test('validates username and password before allowing sign-up', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel(/^Username/).fill('Bad Name!');
    await expect(page.getByText(/2-32 characters/)).toBeVisible();
    await page.getByLabel(/^Password/).fill('short');
    await expect(page.getByText(/At least 8 characters/)).toBeVisible();
  });

  test('signs in with name#tag and signs out from the user panel', async ({ page }) => {
    const pilot = await register('login');
    await page.goto('/');
    await page.getByLabel(/^Email or tag/).fill(`${pilot.transmitter.username}#${pilot.transmitter.discriminator}`);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();

    // The session survives a reload.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();

    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Log Out' }).click();
    await page.getByRole('dialog', { name: 'Log Out' }).getByRole('button', { name: 'Log Out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('rejects a wrong password without revealing which part was wrong', async ({ page }) => {
    const pilot = await register('badpw');
    await page.goto('/');
    await page.getByLabel(/^Email or tag/).fill(pilot.transmitter.email);
    await page.getByLabel(/^Password/).fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toHaveCount(0);
  });
});
