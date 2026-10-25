import { test, expect, register, signIn, openAs } from './fixtures';
import type { Page } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function send(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: /^Transmit to @/ });
  await composer.fill(text);
  await composer.press('Enter');
}

test.describe('End-to-end encrypted direct links', () => {
  test('turn on encryption, talk, and the server only ever holds ciphertext', async ({ page, me, browser }) => {
    test.setTimeout(90_000);
    const friend = await register('friend', 'Cipher Friend');
    await me.api.befriend(friend);
    const { linkId } = await me.api.openDm(friend, 'before encryption');

    const theirs = await openAs(browser, friend, `/channels/@me/${linkId}`);
    await signIn(page, me, `/channels/@me/${linkId}`);

    await page.getByRole('button', { name: 'Turn On Encryption' }).click();
    await page.getByRole('dialog', { name: 'Turn on end-to-end encryption?' }).getByRole('button', { name: 'Turn On' }).click();
    await expect(page.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();
    await expect(page.getByRole('log')).toContainText('turned on end-to-end encryption');
    await expect(theirs.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();

    await send(page, 'the launch code is orbital-42');
    await expect(theirs.getByRole('log').getByRole('article').filter({ hasText: 'the launch code is orbital-42' })).toBeVisible({ timeout: 15_000 });
    await send(theirs, 'copy that, burning after reading');
    await expect(page.getByRole('log').getByRole('article').filter({ hasText: 'copy that, burning after reading' })).toBeVisible({ timeout: 15_000 });

    // What the server stores and serves: no plaintext anywhere.
    const { transmissions } = await me.api.get(`/channels/link/${linkId}/transmissions`);
    const secret = transmissions.find((t: any) => t.encrypted && t.author.id === me.transmitter.id);
    expect(secret.content).toBe('');
    expect(JSON.stringify(transmissions)).not.toContain('orbital-42');
    expect(JSON.stringify(transmissions)).not.toContain('burning after reading');
    // And it refuses plaintext from now on.
    await expect(me.api.post(`/channels/link/${linkId}/transmissions`, { content: 'plaintext sneaking in' })).rejects.toThrow(/ENCRYPTION_REQUIRED/);

    // History survives a reload on both sides (decrypted copies are kept on the device).
    await page.reload();
    await expect(page.getByRole('log').getByRole('article').filter({ hasText: 'the launch code is orbital-42' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('log').getByRole('article').filter({ hasText: 'copy that, burning after reading' })).toBeVisible();

    // Safety numbers: what I see for my device is what they see for it.
    await page.getByRole('button', { name: 'End-to-End Encrypted' }).click();
    const mine = (await page.getByLabel('Your safety number').textContent())!.trim();
    expect(mine).toMatch(/^(\d{5} ){11}\d{5}$/);
    await theirs.getByRole('button', { name: 'End-to-End Encrypted' }).click();
    await expect(theirs.getByRole('list', { name: /safety numbers$/ })).toContainText(mine);
    await theirs.context().close();
  });

  test('a new device cannot read older transmissions, but gets new ones', async ({ page, me, browser }) => {
    test.setTimeout(90_000);
    const friend = await register('friend', 'Second Device');
    await me.api.befriend(friend);
    const { linkId } = await me.api.openDm(friend, 'hello');
    const first = await openAs(browser, friend, `/channels/@me/${linkId}`);
    await signIn(page, me, `/channels/@me/${linkId}`);
    await page.getByRole('button', { name: 'Turn On Encryption' }).click();
    await page.getByRole('dialog', { name: 'Turn on end-to-end encryption?' }).getByRole('button', { name: 'Turn On' }).click();
    // Send only once encryption is on, or the message races the switch.
    await expect(page.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();
    await send(page, 'only for the first device');
    await expect(first.getByRole('log')).toContainText('only for the first device', { timeout: 15_000 });

    const second = await openAs(browser, friend, `/channels/@me/${linkId}`);
    await expect(second.getByRole('log')).toContainText('encrypted for other devices', { timeout: 15_000 });
    await expect(second.getByRole('log')).not.toContainText('only for the first device');
    // Wait until the new device has registered, then send again: both devices can read it.
    await expect.poll(async () => (await friend.api.get(`/e2ee/users/${friend.transmitter.id}/devices`)).devices.length).toBe(2);
    await send(page, 'now for every device');
    await expect(second.getByRole('log')).toContainText('now for every device', { timeout: 15_000 });
    await expect(first.getByRole('log')).toContainText('now for every device');
    await first.context().close();
    await second.context().close();
  });

  test('attachments are encrypted on the device; the vault only holds ciphertext', async ({ page, me, browser }) => {
    test.setTimeout(90_000);
    await me.api.post('/vault/disclaimer/accept');
    const friend = await register('friend', 'File Friend');
    await me.api.befriend(friend);
    const { linkId } = await me.api.openDm(friend, 'files incoming');
    const theirs = await openAs(browser, friend, `/channels/@me/${linkId}`);
    await signIn(page, me, `/channels/@me/${linkId}`);
    await page.getByRole('button', { name: 'Turn On Encryption' }).click();
    await page.getByRole('dialog', { name: 'Turn on end-to-end encryption?' }).getByRole('button', { name: 'Turn On' }).click();
    await expect(page.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();

    await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'star-map.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('button', { name: 'Remove star-map.png' })).toBeVisible({ timeout: 15_000 });
    await send(page, 'the map');

    const image = theirs.getByRole('log').getByRole('img', { name: 'star-map.png' });
    await expect(image).toBeVisible({ timeout: 20_000 });
    await expect(image).toHaveAttribute('src', /^blob:/);

    // The stored object is not the PNG.
    const { files } = await me.api.get('/vault/files');
    const stored = files.find((f: any) => f.filename === 'encrypted.bin');
    expect(stored).toBeTruthy();
    const bytes = Buffer.from(await (await page.request.get(`/api/v1/vault/files/${stored.id}`)).body());
    expect(bytes.subarray(1, 4).toString()).not.toBe('PNG');
    expect(bytes.length).toBe(PNG.length + 12 + 16); // nonce + data + GCM tag
    await theirs.context().close();
  });
});
