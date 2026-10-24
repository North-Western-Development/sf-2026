import { test, expect, register, signIn, MAIL_DIR, waitForMailFile } from './fixtures';

// Mail goes through real SMTP to the sink started in global setup.
const tokenLink = (text: string) => /https?:\/\/\S+\/verify-email\?token=[A-Za-z0-9_-]+/.exec(text)?.[0] ?? '';

test.describe('Email verification', () => {
  test('a new account is asked to verify, and the emailed link clears the notice everywhere', async ({ page, browser }) => {
    const pilot = await register('fresh', 'Fresh Pilot', { verified: false });
    await signIn(page, pilot);
    const notice = page.getByRole('status').filter({ hasText: 'verify your account' });
    await expect(notice).toBeVisible();

    await page.getByRole('button', { name: 'User Settings' }).click();
    await expect(page.getByText('Unverified', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    const since = Date.now();
    await notice.getByRole('button', { name: 'Resend' }).click();
    await expect(page.getByText('Verification email sent. Check your inbox.')).toBeVisible();
    const mail = await waitForMailFile(MAIL_DIR, pilot.transmitter.email, /Verify your Subspace Frequency email/, { since });
    const link = tokenLink(mail.text);
    expect(link).toContain('http://localhost:4173/verify-email?token=');

    // Open the link in a separate, signed-out browser: it works without a session.
    const elsewhere = await browser.newContext();
    const tab = await elsewhere.newPage();
    await tab.goto(link);
    await expect(tab.getByRole('heading', { name: 'Email Verified!' })).toBeVisible();
    await expect(tab).toHaveURL(/\/verify-email$/);
    await elsewhere.close();

    // The open app hears about it and drops the notice without a reload.
    await expect(notice).toHaveCount(0);
  });

  test('a used or broken link explains itself', async ({ page }) => {
    await page.goto('/verify-email?token=not-a-real-token-at-all-000000');
    await expect(page.getByRole('heading', { name: 'Verification Failed' })).toBeVisible();
    await expect(page.getByText('This link is invalid or was already used.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Subspace' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});
