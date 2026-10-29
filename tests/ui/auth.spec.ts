import { test, expect, register, signIn, uniqueName, PASSWORD } from './fixtures';

test.describe('Authentication', () => {
  test('registers a new account through the form and lands in the app', async ({ page }) => {
    const username = uniqueName('signup');
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel(/^Email/).fill(`${username}@ui-test.subspace`);
    await page.getByLabel(/^Display name/).fill('Signup Pilot');
    await page.getByLabel(/^Username/).fill(username);
    await expect(page.getByText(`You'll get a unique tag like ${username}#0427.`)).toBeVisible();
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await expect(page.getByRole('note', { name: 'Not available in the EU' })).toContainText('does not comply with the GDPR');

    const submit = page.getByRole('button', { name: 'Continue' });
    await expect(submit).toBeDisabled();
    await page.getByRole('checkbox').check();
    await submit.click();

    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
    await expect(page.getByText('Signup Pilot').first()).toBeVisible();
  });

  test('the cookie notice shows on a first visit and stays dismissed', async ({ page }) => {
    // Undo the suite's automatic dismissal, once: a first visit.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('ui-test-cookie-notice')) return;
      sessionStorage.setItem('ui-test-cookie-notice', 'show');
      localStorage.removeItem('subspace:cookie-notice');
    });
    await page.goto('/');
    const notice = page.getByRole('region', { name: 'Cookie notice' });
    await expect(notice).toContainText('only essential cookies');
    await notice.getByRole('button', { name: 'Got it' }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
  });

  for (const [app, flag] of [
    ['desktop', 'window.subspaceDesktop = true;'],
    ['mobile', "window.subspaceNative = { platform: 'android', push: null, post: function () {} };"],
  ] as const) {
    test(`the ${app} app never shows the cookie notice, even on a first visit`, async ({ page }) => {
      await page.addInitScript(flag);
      await page.addInitScript(() => localStorage.removeItem('subspace:cookie-notice'));
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
    });
  }

  test('a refused region (BLOCK_EU) sees the 401 page instead of the app, but can still read the legal pages', async ({ page }) => {
    await page.route('**/api/v1/**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Subspace Frequency is not available in your region', code: 'REGION_BLOCKED' }) })
    );
    for (const path of ['/', '/register', '/channels/@me']) {
      await page.goto(path);
      const block = page.getByRole('alert', { name: 'Not available in your region' });
      await expect(block).toContainText('Error 401');
      await expect(block).toContainText('does not comply with the GDPR');
      await expect(page.getByRole('textbox')).toHaveCount(0);
    }
    await page.getByRole('link', { name: 'Privacy Policy' }).click();
    await expect(page.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible();
  });

  test('a sign-up form taller than the window starts at its top and scrolls to its end', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeInViewport();
    const login = page.getByRole('link', { name: 'Already have an account?' }).or(page.getByRole('button', { name: 'Already have an account?' }));
    await login.scrollIntoViewIfNeeded();
    await expect(login).toBeInViewport();
  });

  test('the privacy policy, terms and SMS terms are public, and linked from sign-up and the homepage', async ({ page }) => {
    for (const [path, heading, text] of [
      ['/privacy', 'Privacy Policy', 'never shared with or sold to third parties'],
      ['/terms', 'Terms of Service', 'at least 13 years old'],
      ['/sms', 'SMS Terms', 'Reply STOP to opt out'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.getByRole('main')).toContainText(text);
      // Long pages scroll: the last paragraph can be brought into view.
      const last = page.getByRole('main').locator('p').last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
    }
    await page.goto('/');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    await page.goto('/register');
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
  });

  test('validates username and password before allowing sign-up', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel(/^Username/).fill('Bad Name!');
    await expect(page.getByText(/2-32 characters/)).toBeVisible();
    await page.getByLabel(/^Password/).fill('short');
    await expect(page.getByText(/At least 8 characters/)).toBeVisible();
  });

  test('signs in with name#tag and signs out from the user panel', async ({ page }) => {
    const pilot = await register('login');
    await page.goto('/login');
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
    await page.goto('/login');
    await page.getByLabel(/^Email or tag/).fill(pilot.transmitter.email);
    await page.getByLabel(/^Password/).fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toHaveCount(0);
  });
});

test.describe('Homepage', () => {
  test('everyone lands on the homepage; signed out it leads to sign-in and sign-up', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your frequency.');
    await expect(page.getByRole('img', { name: /Subspace Frequency: a beacon/ })).toBeVisible();
    await page.getByRole('banner').getByRole('button', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.goBack();
    await page.getByRole('button', { name: 'Open Subspace in your browser' }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  });

  test('signed in, the homepage opens the app instead', async ({ page, me }) => {
    await signIn(page, me);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your frequency.');
    await expect(page.getByRole('banner').getByRole('button', { name: 'Log In' })).toHaveCount(0);
    await page.getByRole('banner').getByRole('button', { name: 'Open Subspace' }).click();
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
    await expect(page).toHaveURL(/\/channels\/@me$/);
  });

  test('the desktop and mobile apps open the app at /, not the homepage', async ({ page, me }) => {
    await page.addInitScript(() => ((window as any).subspaceDesktop = true));
    await signIn(page, me, '/');
    await expect(page).toHaveURL(/\/channels\/@me$/);
    await expect(page.getByRole('heading', { level: 1, name: /Your frequency/ })).toHaveCount(0);
  });
});
