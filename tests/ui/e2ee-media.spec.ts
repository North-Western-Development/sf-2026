import { test, expect, register, signIn, openAs } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';
import type { Page } from '@playwright/test';

// Real LiveKit with fake camera/microphone. With frame encryption on, video only decodes on
// the other side if both ended up with the same key, so frames arriving proves the key
// exchange worked end to end.
test.use({
  launchOptions: { args: MEDIA_ARGS },
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
    // As the desktop app: screenshot protection while the encrypted DM is open, but not during the call.
    const asks: string[] = [];
    await page.route('https://subspace-desktop.invalid/**', (route) => {
      asks.push(new URL(route.request().url()).searchParams.get('on')!);
      return route.abort('aborted');
    });
    await page.addInitScript(() => Object.assign(window, { subspaceDesktop: true, subspaceDesktopFeatures: ['content-protection'] }));
    await signIn(page, me, `/channels/@me/${linkId}`);

    await page.getByRole('button', { name: 'Turn On Encryption' }).click();
    await page.getByRole('dialog', { name: 'Turn on end-to-end encryption?' }).getByRole('button', { name: 'Turn On' }).click();
    await expect(theirs.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();

    await page.getByRole('button', { name: 'Start Video Call' }).click();
    const call = page.getByRole('region', { name: 'Call' });
    await expect(call).toHaveAttribute('data-e2ee', 'true', { timeout: 20_000 });
    await expect(call).toContainText('End-to-end encrypted');
    await expect.poll(() => asks).toEqual(['1', '0']);

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

  test('when someone leaves an encrypted Comm-Link, the others move to a new key and keep hearing each other', async ({ page, me, browser }) => {
    test.setTimeout(150_000);
    const a = await register('crewa', 'Crew Alpha');
    const b = await register('crewb', 'Crew Bravo');
    const { beacon, relays } = await me.api.createBeacon('Rotating Bridge');
    const comm = relays.find((r) => r.type === 'comm_link')!;
    await me.api.patch(`/beacons/${beacon.id}/relays/${comm.id}`, { isE2ee: true });
    const { code } = await me.api.createInvite(beacon.id);
    await a.api.join(beacon.id, code);
    await b.api.join(beacon.id, code);

    await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
    const pa = await openAs(browser, a, `/channels/${beacon.id}/${comm.id}`);
    const pb = await openAs(browser, b, `/channels/${beacon.id}/${comm.id}`);
    for (const p of [pa, pb]) await p.context().grantPermissions(['microphone', 'camera']);
    const keyOf = (p: Page) => p.evaluate(() => (window as any).__subspaceRoomKey?.() as { key: string; epoch: number } | null);

    await page.getByRole('button', { name: /^Join / }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('main').getByRole('button', { name: 'Turn On Camera' }).click();
    for (const p of [pa, pb]) {
      await p.getByRole('button', { name: /^Join / }).click();
      await expect(p.locator('[data-e2ee="true"]')).toBeVisible({ timeout: 20_000 });
    }
    await decodedWidth(pa, pa.getByRole('main'), me.transmitter.displayName);
    const before = (await keyOf(page))!;
    await expect.poll(async () => (await keyOf(pb))?.key).toBe(before.key);

    // Bravo leaves: the two left agree a new key, one epoch on.
    await pb.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();
    await expect.poll(async () => (await keyOf(page))?.epoch, { timeout: 20_000 }).toBe(before.epoch + 1);
    await expect.poll(async () => (await keyOf(pa))?.epoch, { timeout: 20_000 }).toBe(before.epoch + 1);
    const after = (await keyOf(page))!;
    expect(after.key).not.toBe(before.key);
    expect((await keyOf(pa))!.key).toBe(after.key);

    // Once everyone sends with the new key, video still decodes for Alpha.
    await page.waitForTimeout(2500);
    const video = pa.getByRole('main').getByRole('group', { name: me.transmitter.displayName }).locator('video');
    const frames = () => video.evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames);
    const start = await frames();
    await expect.poll(frames, { timeout: 15_000 }).toBeGreaterThan(start + 10);
    for (const p of [pa, pb]) await p.context().close();
  });
});
