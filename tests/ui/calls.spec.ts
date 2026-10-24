import { test, expect, register, signIn, openAs } from './fixtures';

// Real LiveKit, with Chromium's fake camera and microphone, as in voice.spec.ts.
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone', 'camera'],
});

test.describe('Direct link calls', () => {
  test('ring, answer, talk with video, and hang up', async ({ page, me, browser }) => {
    test.setTimeout(90_000);
    const friend = await register('friend', 'Call Friend');
    await me.api.befriend(friend);
    const { linkId } = await me.api.openDm(friend, 'call you in a sec');

    await signIn(page, me, `/channels/@me/${linkId}`);
    const theirs = await openAs(browser, friend, `/channels/@me/${linkId}`);
    await theirs.context().grantPermissions(['microphone', 'camera']);

    await page.getByRole('button', { name: 'Start Voice Call' }).click();
    const call = page.getByRole('region', { name: 'Call' });
    await expect(call.getByRole('group', { name: me.transmitter.displayName })).toBeVisible({ timeout: 20_000 });
    await expect(call.getByRole('group', { name: 'Ringing Call Friend' })).toBeVisible();
    await expect(page.getByRole('log')).toContainText('started a call.');

    // The friend is rung, wherever they are in the app.
    const prompt = theirs.getByRole('alertdialog', { name: `Incoming call from ${me.transmitter.displayName}` });
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await prompt.getByRole('button', { name: 'Accept with Video' }).click();
    await expect(prompt).toHaveCount(0);

    const myTileForThem = theirs.getByRole('region', { name: 'Call' }).getByRole('group', { name: me.transmitter.displayName });
    await expect(myTileForThem).toBeVisible({ timeout: 20_000 });
    await expect(call.getByRole('group', { name: 'Call Friend' })).toBeVisible({ timeout: 20_000 });
    await expect(call.getByRole('group', { name: 'Ringing Call Friend' })).toHaveCount(0);
    // Their camera reaches me as real frames, and my microphone reaches them.
    const video = call.getByRole('group', { name: 'Call Friend' }).locator('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(myTileForThem).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });

    // The user panel shows the call, not a Comm-Link.
    await expect(page.getByText('Voice Connected')).toBeVisible();

    // One leaves: the call goes on. The last one leaves: it ends with its length.
    await page.getByRole('button', { name: 'Leave Call' }).click();
    await expect(theirs.getByRole('region', { name: 'Call' }).getByRole('group', { name: me.transmitter.displayName })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Call' }).getByRole('button', { name: 'Join Call' })).toBeVisible();
    await theirs.getByRole('button', { name: 'Leave Call' }).click();
    await expect(page.getByRole('region', { name: 'Call' })).toHaveCount(0);
    await expect(page.getByRole('log')).toContainText('started a call that lasted a few seconds.');
    await expect(theirs.getByRole('log')).toContainText('started a call that lasted a few seconds.');
    await theirs.context().close();
  });

  test('declining stops the ringing, and an unanswered call shows as missed', async ({ page, me, browser }) => {
    test.setTimeout(60_000);
    const friend = await register('friend', 'Busy Friend');
    await me.api.befriend(friend);
    const { linkId } = await me.api.openDm(friend, 'ping');

    await signIn(page, me, `/channels/@me/${linkId}`);
    const theirs = await openAs(browser, friend);

    await page.getByRole('button', { name: 'Start Voice Call' }).click();
    const prompt = theirs.getByRole('alertdialog', { name: /^Incoming call from / });
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await prompt.getByRole('button', { name: 'Decline' }).click();
    await expect(prompt).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Call' }).getByRole('group', { name: 'Ringing Busy Friend' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Leave Call' }).click();
    await theirs.goto(`/channels/@me/${linkId}`);
    await expect(theirs.getByRole('log')).toContainText(`You missed a call from ${me.transmitter.displayName} that lasted a few seconds.`);
    await expect(page.getByRole('log')).toContainText('started a call that lasted a few seconds.');
    await theirs.context().close();
  });
});
