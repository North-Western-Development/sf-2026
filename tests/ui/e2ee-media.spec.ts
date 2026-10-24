import { test, expect, register, signIn, openAs } from './fixtures';
import type { Page } from '@playwright/test';

// Real LiveKit with fake camera/microphone. With frame encryption on, video only decodes on
// the other side if both ended up with the same key, so frames arriving proves the key
// exchange worked end to end.
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone', 'camera'],
});

async function decodedWidth(page: Page, scope: ReturnType<Page['getByRole']>, name: string) {
  const video = scope.getByRole('group', { name }).locator('video');
  await expect(video).toBeVisible({ timeout: 20_000 });
  return expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 25_000 }).toBeGreaterThan(0);
}

test.describe('End-to-end encrypted voice and video', () => {
  test('a call in an encrypted direct link agrees a frame key and carries video both ways', async ({ page, me, browser }) => {
    test.setTimeout(120_000);
    const friend = await register('friend', 'Secure Caller');
    await me.api.befriend(friend);
    const { linkId } = await me.api.openDm(friend, 'secure line?');
    const theirs = await openAs(browser, friend, `/channels/@me/${linkId}`);
    await theirs.context().grantPermissions(['microphone', 'camera']);
    await signIn(page, me, `/channels/@me/${linkId}`);

    await page.getByRole('button', { name: 'Turn On Encryption' }).click();
    await page.getByRole('dialog', { name: 'Turn on end-to-end encryption?' }).getByRole('button', { name: 'Turn On' }).click();
    await expect(theirs.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();

    await page.getByRole('button', { name: 'Start Video Call' }).click();
    const call = page.getByRole('region', { name: 'Call' });
    await expect(call).toHaveAttribute('data-e2ee', 'true', { timeout: 20_000 });
    await expect(call).toContainText('End-to-end encrypted');

    await theirs.getByRole('alertdialog', { name: /^Incoming call from / }).getByRole('button', { name: 'Accept with Video' }).click();
    const theirCall = theirs.getByRole('region', { name: 'Call' });
    await expect(theirCall).toHaveAttribute('data-e2ee', 'true', { timeout: 20_000 });

    await decodedWidth(theirs, theirCall, me.transmitter.displayName);
    await decodedWidth(page, call, 'Secure Caller');
    await theirs.context().close();
  });

  test('an encrypted Comm-Link shares its key with each person who joins', async ({ page, me, browser }) => {
    test.setTimeout(120_000);
    const crew = await register('crew', 'Crew Cipher');
    const { beacon, relays } = await me.api.createBeacon('Secure Bridge');
    const comm = relays.find((r) => r.type === 'comm_link')!;
    await me.api.patch(`/beacons/${beacon.id}/relays/${comm.id}`, { isE2ee: true });
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);

    await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${comm.id}`);
    await theirs.context().grantPermissions(['microphone', 'camera']);
    await expect(page.getByRole('banner').or(page.locator('header')).first()).toContainText('End-to-end encrypted');

    await page.getByRole('button', { name: /^Join / }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('main').getByRole('button', { name: 'Turn On Camera' }).click();

    await theirs.getByRole('button', { name: /^Join / }).click();
    await expect(theirs.locator('[data-e2ee="true"]')).toBeVisible({ timeout: 20_000 });

    // The person who joined second got the key from the first: the owner's video decodes for them.
    // (Members cannot use the camera in a Comm-Link by default, so video flows one way here.)
    await decodedWidth(theirs, theirs.getByRole('main'), me.transmitter.displayName);
    await theirs.context().close();
  });
});
