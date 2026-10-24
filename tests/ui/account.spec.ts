import { test, expect, signIn, register, PASSWORD, BASE_URL, type Session } from './fixtures';
import { request as playwrightRequest, type Page } from '@playwright/test';

async function openAccount(page: Page) {
  await page.getByRole('button', { name: 'User Settings' }).click();
  return page.getByRole('dialog', { name: 'User Settings' });
}

/** Sign in again through the API, as another device would; returns that device's session. */
async function secondDevice(me: Session, userAgent: string): Promise<Session> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'user-agent': userAgent } });
  const res = await ctx.post('/api/v1/auth/login', { data: { username: me.transmitter.email, password: PASSWORD } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return { ...me, accessToken: body.accessToken, refreshToken: body.refreshToken };
}

async function signInWithPassword(page: Page, me: Session) {
  await page.getByLabel('Email or tag').fill(me.transmitter.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('Account settings', () => {
  test('Devices lists other sign-ins and logging one out signs that device out live', async ({ page, me, browser }) => {
    const phone = await secondDevice(me, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const other = await otherContext.newPage();
    await signIn(other, phone);

    await signIn(page, me);
    const settings = await openAccount(page);
    await settings.getByRole('navigation', { name: /User Settings sections/ }).getByRole('button', { name: 'Devices', exact: true }).click();
    await expect(settings.getByRole('list', { name: 'Current device' })).toContainText(/Current session/);
    const others = settings.getByRole('list', { name: 'Other devices' });
    await expect(others.getByRole('listitem', { name: 'iOS · Safari' })).toBeVisible();

    await others.getByRole('button', { name: 'Log out iOS · Safari' }).click();
    await page.getByRole('dialog', { name: 'Log out device?' }).getByRole('button', { name: 'Log Out' }).click();
    await expect(settings.getByText("You're not signed in anywhere else.")).toBeVisible();

    // The phone is dropped by the gateway and lands on the sign-in screen without reloading.
    await expect(other.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await otherContext.close();

    // This device is unaffected.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
  });

  test('changing the email needs the current password', async ({ page, me }) => {
    await signIn(page, me);
    const settings = await openAccount(page);
    const emailRow = settings.locator('div').filter({ has: page.getByText('Email', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last();
    await emailRow.getByRole('button', { name: 'Edit' }).click();

    const dialog = page.getByRole('dialog', { name: 'Enter an email address' });
    const next = `new_${me.transmitter.username}@ui-test.subspace`;
    await dialog.getByLabel(/^Email/).fill(next);
    await dialog.getByLabel(/^Current Password/).fill('not-my-password');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog.getByText('Password does not match.')).toBeVisible();

    await dialog.getByLabel(/^Current Password/).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);
    await settings.getByRole('button', { name: 'Reveal' }).click();
    await expect(settings).toContainText(next);
  });

  test('changing the username needs the current password', async ({ page, me }) => {
    await signIn(page, me);
    const settings = await openAccount(page);
    const row = settings.locator('div').filter({ has: page.getByText('Username', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last();
    await row.getByRole('button', { name: 'Edit' }).click();

    const dialog = page.getByRole('dialog', { name: 'Change your username' });
    const renamed = `${me.transmitter.username.slice(0, 24)}_new`;
    await dialog.getByLabel(/^Username/).fill(renamed);
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();
    await dialog.getByLabel(/^Current Password/).fill('wrong-password-here');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog.getByText('Password does not match.')).toBeVisible();

    await dialog.getByLabel(/^Current Password/).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(settings).toContainText(`${renamed}#`);
  });

  test('a disabled account signs out and can be restored by signing in', async ({ page, me }) => {
    await signIn(page, me);
    const settings = await openAccount(page);
    await settings.getByRole('button', { name: 'Disable Account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Disable Account' });
    await dialog.getByLabel(/^Current Password/).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Disable Account' }).click();

    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await signInWithPassword(page, me);
    await expect(page.getByRole('heading', { name: 'Account Disabled' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore Account' }).click();
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
  });

  test('deleting asks owners to hand over beacons first, then removes the account for good', async ({ page, browser }) => {
    const owner = await register('owner');
    await owner.api.createBeacon('Still Mine');
    await signIn(page, owner);
    let settings = await openAccount(page);
    await settings.getByRole('button', { name: 'Delete Account' }).click();
    let dialog = page.getByRole('dialog', { name: 'Delete Account' });
    await dialog.getByLabel(/^Current Password/).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Delete Account' }).click();
    const blocked = page.getByRole('dialog', { name: /You Own/ });
    await expect(blocked).toContainText('Still Mine');
    await blocked.getByRole('button', { name: 'Okay' }).click();

    const leaver = await register('leaver');
    const freshContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const fresh = await freshContext.newPage();
    await signIn(fresh, leaver);
    settings = await openAccount(fresh);
    await settings.getByRole('button', { name: 'Delete Account' }).click();
    dialog = fresh.getByRole('dialog', { name: 'Delete Account' });
    await dialog.getByLabel(/^Current Password/).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Delete Account' }).click();

    await expect(fresh.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await signInWithPassword(fresh, leaver);
    await expect(fresh.getByRole('alert')).toHaveText(/credentials do not match/);
    await expect(fresh.getByRole('navigation', { name: 'Beacons' })).toHaveCount(0);
    await freshContext.close();
  });
});
