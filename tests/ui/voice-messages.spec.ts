import { test, expect, register, signIn, openAs } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';
import { PERMISSIONS } from '@subspace/constants';

test.use({ launchOptions: { args: MEDIA_ARGS }, permissions: ['microphone'] });

test('a recorded voice message is sent and plays back', async ({ page, me }) => {
  const { beacon, relays } = await me.api.createBeacon('Voice Notes');
  const general = relays.find((r) => r.type === 'text')!;
  await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
  await page.getByRole('button', { name: 'Record a voice message' }).click();
  await expect(page.getByRole('group', { name: 'Recording a voice message' })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Send voice message' }).click();
  // The first upload asks to acknowledge that uploads are reachable by link.
  await page.getByRole('dialog', { name: 'Before you upload' }).getByRole('button', { name: 'I understand' }).click();
  const note = page.getByRole('log').getByRole('group', { name: 'Voice message' });
  await expect(note).toBeVisible({ timeout: 15_000 });
  await expect(note).toContainText(/0:0[1-2]/);
  // A real recording the browser can load.
  await expect.poll(() => note.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 10_000 }).toBeGreaterThan(0);
});

test('without Use Voice Activity a member talks only while holding push-to-talk', async ({ page, me, browser }) => {
  test.setTimeout(90_000);
  const quiet = await register('pttuser', 'PTT User');
  const { beacon, relays } = await me.api.createBeacon('PTT Room');
  const comm = relays.find((r) => r.type === 'comm_link')!;
  await quiet.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);
  const everyone = (await me.api.get(`/beacons/${beacon.id}/clearances`)).clearances.find((c: any) => c.position === 0);
  await me.api.patch(`/beacons/${beacon.id}/clearances/${everyone.id}`, { permissions: (BigInt(everyone.permissions) & ~PERMISSIONS.USE_VOICE_ACTIVITY).toString() });

  await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
  await page.getByRole('button', { name: /^Join / }).click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  const theirs = await openAs(browser, quiet, `/channels/${beacon.id}/${comm.id}`);
  await theirs.context().grantPermissions(['microphone']);
  await theirs.getByRole('button', { name: /^Join / }).click();
  await expect(theirs.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });

  const tile = page.getByRole('main').getByRole('group', { name: 'PTT User' });
  await expect(tile).toBeVisible();
  // Their (always talking) fake microphone is silent until they hold the key.
  await theirs.waitForTimeout(3000);
  await expect(tile).not.toHaveAttribute('data-speaking', 'true');
  await theirs.locator('body').click({ position: { x: 5, y: 400 } });
  await theirs.keyboard.down('Backquote');
  await expect(tile).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
  await theirs.keyboard.up('Backquote');
  await expect(tile).not.toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
});
