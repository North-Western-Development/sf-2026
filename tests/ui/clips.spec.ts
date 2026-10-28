import { test, expect, register, signIn, openAs } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';

test.use({
  launchOptions: { args: [...MEDIA_ARGS, '--auto-select-desktop-capture-source=Entire screen'] },
  permissions: ['microphone'],
});

test('with Clips on, a Holo-Cast can be clipped and the clip shows in the gallery', async ({ page }) => {
  test.setTimeout(90_000);
  const me = await register('clipper', 'Clip Pilot');
  const { beacon, relays } = await me.api.createBeacon('Clip Room');
  const comm = relays.find((r) => r.type === 'comm_link')!;
  await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);

  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Voice & Video', exact: true }).click();
  await page.getByRole('switch', { name: 'Enable Clips' }).click();
  await page.getByRole('radio', { name: '30 seconds' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Join / }).click();
  const controls = page.getByRole('main');
  await expect(controls.getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  await controls.getByRole('button', { name: /^Start Holo/ }).click();
  const clip = controls.getByRole('button', { name: /^Clip/ });
  await expect(clip).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByText('Clip saved.', { exact: false })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Open your profile' }).click();
  await page.getByRole('dialog', { name: 'Your profile' }).getByRole('button', { name: 'Clips' }).click();
  const gallery = page.getByRole('list', { name: 'Clips' });
  await expect(gallery.getByRole('listitem')).toHaveCount(1);
  // A real recording: it has a duration.
  await expect.poll(() => gallery.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10_000 }).toBeGreaterThan(0);

  await gallery.getByRole('button', { name: /^Delete / }).click();
  await page.getByRole('dialog', { name: 'Delete Clip' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No clips yet')).toBeVisible();
});

test('a clip mixes in whoever joins after the Holo-Cast starts, and they are warned', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const me = await register('clipmix', 'Mix Pilot');
  const late = await register('latecomer', 'Late Comer');
  const { beacon, relays } = await me.api.createBeacon('Mix Room');
  const comm = relays.find((r) => r.type === 'comm_link')!;
  await late.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);
  await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
  await page.evaluate(() => localStorage.setItem('subspace_clip_prefs', JSON.stringify({ enabled: true, length: 30 })));
  await page.reload();

  await page.getByRole('button', { name: /^Join / }).click();
  const controls = page.getByRole('main');
  await expect(controls.getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  await controls.getByRole('button', { name: /^Start Holo/ }).click();
  const mix = page.getByTestId('clip-control');
  await expect(mix).toHaveAttribute('data-voices', '1', { timeout: 15_000 });

  const theirs = await openAs(browser, late, `/channels/${beacon.id}/${comm.id}`);
  await theirs.context().grantPermissions(['microphone']);
  await theirs.getByRole('button', { name: /^Join / }).click();
  await expect(theirs.getByText('Mix Pilot has Clips on.', { exact: false })).toBeVisible({ timeout: 20_000 });
  // Their voice joins the mix without restarting the recording.
  await expect(mix).toHaveAttribute('data-voices', '2', { timeout: 20_000 });
});
