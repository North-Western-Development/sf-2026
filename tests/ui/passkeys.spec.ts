import { test, expect, signIn, PASSWORD } from './fixtures';
import type { Page } from '@playwright/test';

/** Chrome's virtual authenticator: a platform passkey that always verifies the user. */
async function addAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

test.describe('Passkeys', () => {
  test('add a passkey in settings, then sign in with it and no password', async ({ page, me }) => {
    const { cdp, authenticatorId } = await addAuthenticator(page);
    await signIn(page, me);
    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: /^Passkeys/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Passkeys' });
    await expect(dialog).toContainText('You have not added a passkey yet.');
    await dialog.getByRole('button', { name: 'Add a Passkey' }).click();

    const add = page.getByRole('dialog', { name: 'Add a Passkey' });
    await add.getByLabel('Passkey Name').fill('Test laptop');
    await add.getByLabel('Current Password').fill('not-my-password');
    await add.getByRole('button', { name: 'Continue' }).click();
    await expect(add).toContainText('Password does not match.');
    await add.getByLabel('Current Password').fill(PASSWORD);
    await add.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Passkey added. You can sign in with it now.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Your passkeys' })).toContainText('Test laptop');
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(credentials).toHaveLength(1);
    expect(credentials[0].isResidentCredential).toBe(true);

    // Sign out, then back in with only the passkey.
    await page.getByRole('dialog', { name: 'Passkeys' }).getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Log Out' }).click();
    await page.getByRole('dialog', { name: 'Log Out' }).getByRole('button', { name: 'Log Out' }).click();
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'User Settings' })).toBeVisible();
  });

  test('a removed passkey no longer signs in', async ({ page, me }) => {
    await addAuthenticator(page);
    await signIn(page, me);
    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: /^Passkeys/ }).click();
    await page.getByRole('dialog', { name: 'Passkeys' }).getByRole('button', { name: 'Add a Passkey' }).click();
    const add = page.getByRole('dialog', { name: 'Add a Passkey' });
    await add.getByLabel('Current Password').fill(PASSWORD);
    await add.getByRole('button', { name: 'Continue' }).click();
    const list = page.getByRole('list', { name: 'Your passkeys' });
    await expect(list).toContainText('Passkey');

    await list.getByRole('button', { name: 'Remove' }).click();
    const remove = page.getByRole('dialog', { name: 'Remove Passkey' });
    await remove.getByLabel('Current Password').fill(PASSWORD);
    await remove.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('dialog', { name: 'Passkeys' })).toContainText('You have not added a passkey yet.');

    await page.getByRole('dialog', { name: 'Passkeys' }).getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Log Out' }).click();
    await page.getByRole('dialog', { name: 'Log Out' }).getByRole('button', { name: 'Log Out' }).click();
    // The authenticator still holds the key, but the server has forgotten it.
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByText('That passkey is not linked to an account here.')).toBeVisible();
  });
});
