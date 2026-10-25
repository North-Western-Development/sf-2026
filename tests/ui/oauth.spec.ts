import { test, expect, register, signIn } from './fixtures';

test('a developer app is authorized on the consent page, then shows under Authorized Apps until deauthorized', async ({ page, browser }) => {
  const dev = await register('appdev', 'App Developer');
  const REDIRECT = 'http://127.0.0.1:4195/oauth-cb';

  // The developer creates the app and registers its redirect URI.
  const devPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(devPage, dev);
  await devPage.getByRole('button', { name: 'User Settings' }).click();
  await devPage.getByRole('button', { name: 'Developer Applications', exact: true }).click();
  await devPage.getByRole('button', { name: 'New Application' }).click();
  await devPage.getByRole('dialog', { name: 'Create an Application' }).getByLabel('Name').fill('Star Tracker');
  await devPage.getByRole('button', { name: 'Create', exact: true }).click();
  const secret = (await devPage.getByTestId('client-secret').textContent())!.trim();
  await devPage.getByRole('button', { name: 'Done' }).click();
  const card = devPage.getByRole('listitem', { name: 'Star Tracker' });
  const clientId = (await card.locator('code').first().textContent())!.trim();
  await card.getByRole('textbox').fill(REDIRECT);
  await card.getByRole('button', { name: 'Save Redirects' }).click();
  await expect(devPage.getByText('Redirect URIs saved')).toBeVisible();

  // Someone signs in to it.
  const me = await register('appuser', 'App User');
  const qs = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', scope: 'identify email', state: 's1' });
  await signIn(page, me, `/oauth2/authorize?${qs}`, { shell: false });
  const consent = page.getByRole('region', { name: 'Authorize application' });
  await expect(consent.getByRole('heading', { name: 'Star Tracker' })).toBeVisible();
  await expect(consent.getByRole('list', { name: 'Requested permissions' })).toContainText('Know your email address');
  await consent.getByRole('button', { name: 'Authorize' }).click();
  await page.waitForURL(/127\.0\.0\.1:4195\/oauth-cb\?code=/);
  const url = new URL(page.url());
  expect(url.searchParams.get('state')).toBe('s1');

  // The app trades the code for a token and reads who it is.
  const tokenRes = await fetch('http://localhost:4173/api/v1/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, client_secret: secret }),
  });
  const { access_token } = await tokenRes.json();
  const who = await (await fetch('http://localhost:4173/api/v1/oauth2/@me', { headers: { authorization: `Bearer ${access_token}` } })).json();
  expect(who.user.username).toBe(me.transmitter.username);

  // Authorized Apps lists it; Deauthorize cuts it off.
  await page.goto('/channels/@me');
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Authorized Apps', exact: true }).click();
  const apps = page.getByRole('list', { name: 'Authorized apps' });
  await expect(apps).toContainText('Star Tracker');
  await apps.getByRole('button', { name: 'Deauthorize' }).click();
  await page.getByRole('dialog', { name: 'Deauthorize Star Tracker' }).getByRole('button', { name: 'Deauthorize' }).click();
  await expect(page.getByText('No authorized apps')).toBeVisible();
  expect((await fetch('http://localhost:4173/api/v1/oauth2/@me', { headers: { authorization: `Bearer ${access_token}` } })).status).toBe(401);
});
