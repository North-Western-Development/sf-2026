import { test, expect, signIn } from './fixtures';
import type { Page } from '@playwright/test';

const openSettings = async (page: Page, section: string) => {
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('navigation', { name: /User Settings sections/ }).getByRole('button', { name: section, exact: true }).click();
};

/** What apps/mobile injects before the page loads (src/shell.ts injectedBridge). */
const asMobileShell = (page: Page, push: unknown, pushStatus: unknown) =>
  page.addInitScript(
    ([p, s]) => {
      (window as any).subspaceNative = { platform: 'android', push: p, pushStatus: s, post: () => {} };
    },
    [push, pushStatus] as const
  );

test.describe('Apps and mobile push', () => {
  test('the browser offers the apps for download', async ({ page, me }) => {
    await signIn(page, me);
    await openSettings(page, 'Get the Apps');
    for (const [name, href] of [
      ['Windows', '/downloads/desktop/Subspace-Frequency-Setup.exe'],
      ['Android', '/downloads/mobile/Subspace-Frequency.apk'],
      ['iPhone and iPad', '/downloads/mobile/Subspace-Frequency.ipa'],
    ]) {
      await expect(page.getByRole('link', { name: `Download for ${name}` })).toHaveAttribute('href', href);
    }
    await expect(page.getByText(/Sideloaded copies cannot receive push notifications/)).toBeVisible();
  });

  test('in the app: says why push is unavailable, then registers once the distributor connects', async ({ page, me }) => {
    await asMobileShell(page, null, { status: 'unavailable', reason: 'Install a UnifiedPush app such as ntfy and set its server to https://push.example.test to get notifications while Subspace is closed.' });
    await signIn(page, me);
    await openSettings(page, 'Notifications');
    const status = page.getByRole('status').filter({ hasText: 'Unavailable' });
    await expect(status).toContainText('Install a UnifiedPush app such as ntfy');
    // No download page inside the apps themselves.
    await expect(page.getByRole('navigation', { name: /User Settings sections/ }).getByRole('button', { name: 'Get the Apps' })).toHaveCount(0);

    // The distributor hands over an endpoint: the page registers it with the server.
    const registered = page.waitForRequest((r) => r.url().endsWith('/api/v1/push/tokens') && r.method() === 'POST');
    const keys = await page.evaluate(async () => {
      const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
      const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return { p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) };
    });
    const target = { kind: 'unifiedpush', endpoint: 'https://push.example.test/upAbC123?up=1', ...keys };
    await page.evaluate((t) => {
      const w = window as any;
      w.subspaceNative.push = t;
      w.subspaceNative.pushStatus = { status: 'on', reason: 'Push notifications come through UnifiedPush (push.example.test), encrypted so only this phone can read them.' };
      window.dispatchEvent(new Event('subspace-native-push'));
    }, target);
    const req = await registered;
    expect(req.postDataJSON()).toEqual(target);
    await expect(page.getByRole('status').filter({ hasText: 'On' })).toContainText('encrypted so only this phone can read them');
  });
});
