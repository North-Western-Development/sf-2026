import { test, expect, register, signIn, openAs } from './fixtures';

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});

test.describe('Activities and per-beacon privacy', () => {
  test('a whiteboard drawn in one comm-link shows for the member who joins, who can also join from a profile', async ({ page, me, browser }) => {
    test.setTimeout(90_000);
    const crew = await register('artist', 'Artist');
    const { beacon, relays } = await me.api.createBeacon('Art Room');
    const comm = relays.find((r) => r.type === 'comm_link')!;
    const general = relays.find((r) => r.type === 'text')!;
    await crew.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);

    await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
    await page.getByRole('button', { name: /^Join / }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('main').getByRole('button', { name: 'Start an Activity' }).click();
    await page.getByRole('dialog', { name: 'Activities' }).getByRole('button', { name: /Whiteboard/ }).click();
    const board = page.getByRole('region', { name: 'Whiteboard' }).getByLabel('Whiteboard canvas');
    await expect(board).toBeVisible();
    const box = (await board.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 90, { steps: 8 });
    await page.mouse.move(box.x + 260, box.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect(board).toHaveAttribute('data-strokes', '1');

    // The other member finds it from my profile (Share my activity, Activity joining are on).
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${general.id}`);
    await theirs.context().grantPermissions(['microphone']);
    await theirs.getByRole('complementary', { name: 'Members' }).getByRole('button', { name: new RegExp(me.transmitter.displayName!) }).click();
    const activity = theirs.getByTestId('profile-activity');
    await expect(activity).toContainText('Whiteboard');
    await activity.getByRole('button', { name: 'Join' }).click();
    const theirBoard = theirs.getByRole('region', { name: 'Whiteboard' }).getByLabel('Whiteboard canvas');
    await expect(theirBoard).toHaveAttribute('data-strokes', '1', { timeout: 20_000 });

    // Their stroke reaches me live.
    const b2 = (await theirBoard.boundingBox())!;
    await theirs.mouse.move(b2.x + 50, b2.y + 120);
    await theirs.mouse.down();
    await theirs.mouse.move(b2.x + 200, b2.y + 140, { steps: 8 });
    await theirs.mouse.up();
    await expect(board).toHaveAttribute('data-strokes', '2');

    // Clear wipes it for both.
    await page.getByRole('region', { name: 'Whiteboard' }).getByRole('button', { name: 'Clear' }).click();
    await expect(theirBoard).toHaveAttribute('data-strokes', '0');
  });

  test('turning on Message Requests sends a first DM to Requests', async ({ page, me }) => {
    const other = await register('reqsender', 'Request Sender');
    const { beacon } = await me.api.createBeacon('Quiet Beacon');
    await other.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);

    // The member turns it on in their Privacy Settings for this beacon.
    await signIn(page, other, `/channels/${beacon.id}`);
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Quiet Beacon' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Privacy Settings' }).click();
    const dialog = page.getByRole('dialog', { name: /Privacy Settings/ });
    await dialog.getByRole('switch', { name: /Message requests/ }).click();
    await expect.poll(async () => (await other.api.get(`/beacons/${beacon.id}/members/@me/privacy`)).privacy.messageRequests).toBe(true);
    await dialog.getByRole('button', { name: 'Done' }).click();

    const { link } = await me.api.post('/links', { targetId: other.transmitter.id });
    const res = await fetch(`http://localhost:4173/api/v1/channels/link/${link.id}/transmissions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${me.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello stranger' }),
    });
    expect((await res.json()).code).toBe('MESSAGE_REQUEST_REQUIRED');
  });
});
