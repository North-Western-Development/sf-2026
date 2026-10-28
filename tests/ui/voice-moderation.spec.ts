import { test, expect, register, signIn, openAs, liveKitTracks } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';

test.use({
  launchOptions: { args: MEDIA_ARGS },
  permissions: ['microphone'],
});

test('a moderator server-mutes a member, moves them, and disconnects them', async ({ page, me, browser }) => {
  test.setTimeout(120_000);
  const loud = await register('loudmouth', 'Loud Mouth');
  const { beacon, relays } = await me.api.createBeacon('Moderated Room');
  const comm = relays.find((r) => r.type === 'comm_link')!;
  const { relay: afk } = await me.api.post(`/beacons/${beacon.id}/relays`, { name: 'AFK Lounge', type: 'comm_link' });
  await loud.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);

  await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
  await page.getByRole('button', { name: /^Join / }).click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  const theirs = await openAs(browser, loud, `/channels/${beacon.id}/${comm.id}`);
  await theirs.context().grantPermissions(['microphone']);
  await theirs.getByRole('button', { name: /^Join / }).click();
  await expect(theirs.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  const mic = async () => (await liveKitTracks(comm.id))[loud.transmitter.id] ?? [];
  await expect.poll(mic, { timeout: 20_000 }).toContain('AUDIO/MICROPHONE');

  // Server Mute from their tile: LiveKit drops their microphone, both sides show it, and they
  // cannot unmute themselves.
  const tile = page.getByRole('main').getByRole('group', { name: 'Loud Mouth' });
  await tile.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Server Mute' }).click();
  await expect(tile.getByLabel('Server muted')).toBeVisible();
  await expect.poll(mic, { timeout: 20_000 }).not.toContain('AUDIO/MICROPHONE');
  await expect(theirs.getByRole('main').getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
  await theirs.getByRole('main').getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect(theirs.getByText('A moderator muted you in this beacon.')).toBeVisible();

  // Lifting it gives them their microphone back.
  await tile.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Server Mute' }).click();
  await expect(tile.getByLabel('Server muted')).toHaveCount(0);

  // Move them from the sidebar.
  const sidebarEntry = page.getByRole('navigation').getByRole('listitem', { name: 'Loud Mouth' });
  await sidebarEntry.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move To' }).hover();
  await page.getByRole('menuitem', { name: 'afk-lounge' }).click();
  await expect(theirs.getByText('A moderator moved you to afk-lounge.')).toBeVisible();
  await expect.poll(async () => Object.keys(await liveKitTracks(afk.id)), { timeout: 20_000 }).toContain(loud.transmitter.id);

  // And disconnect them.
  await page.getByRole('navigation').getByRole('listitem', { name: 'Loud Mouth' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Disconnect' }).click();
  await expect(theirs.getByText('A moderator disconnected you from voice.')).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('listitem', { name: 'Loud Mouth' })).toHaveCount(0, { timeout: 20_000 });
});
