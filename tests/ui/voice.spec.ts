import { test, expect, register, signIn, openAs } from './fixtures';

// Chromium's fake camera (a test pattern) and microphone (a beep), granted without a prompt,
// so two pilots can talk through the real LiveKit server.
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone', 'camera'],
});

test.describe('Comm-Links (voice and video)', () => {
  test('two pilots join, hear each other, and see a camera', async ({ page, me, browser }) => {
    test.setTimeout(90_000);
    const crew = await register('crew', 'Crew Member');
    const { beacon, relays } = await me.api.createBeacon('Bridge Crew');
    const comm = relays.find((r) => r.type === 'comm_link')!;
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);

    await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${comm.id}`);
    await theirs.context().grantPermissions(['microphone', 'camera']);

    await page.getByRole('button', { name: /^Join / }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
    // The other pilot sees who is in the Comm-Link before joining.
    const myTileForThem = theirs.getByRole('group', { name: me.transmitter.displayName });
    await expect(myTileForThem).toBeVisible();

    await theirs.getByRole('button', { name: /^Join / }).click();
    await expect(theirs.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('group', { name: 'Crew Member' })).toBeVisible();

    // Audio reaches the SFU: LiveKit reports my fake microphone as speaking to the other pilot.
    await expect(myTileForThem).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });

    // Muting shows on both sides and silences the speaking ring.
    await page.getByRole('main').getByRole('button', { name: 'Mute', exact: true }).click();
    await expect(myTileForThem.getByLabel('Muted')).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect(myTileForThem.getByLabel('Muted')).toHaveCount(0);

    // Camera: the other pilot receives real frames.
    await page.getByRole('main').getByRole('button', { name: 'Turn On Camera' }).click();
    const video = myTileForThem.locator('video');
    await expect(video).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.getByRole('main').getByRole('button', { name: 'Turn Off Camera' }).click();
    await expect(video).toHaveCount(0);

    // Leaving removes the tile for everyone.
    await page.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();
    await expect(myTileForThem).toHaveCount(0);
    await theirs.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();
    await theirs.context().close();
  });
});
