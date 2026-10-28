import { test, expect, register, signIn, openAs } from './fixtures';
import type { Page } from '@playwright/test';

/** Set one permission for the selected target in an open Permissions tab. */
async function setPermission(page: Page, label: string, state: 'allow' | 'deny' | 'inherit') {
  await page.getByRole('radiogroup', { name: label, exact: true }).getByRole('radio', { name: state }).click();
}

test('a band hides its synced relays; a relay can get its own permissions, move bands and sync again', async ({ page, me, browser }) => {
  test.setTimeout(90_000);
  const crew = await register('bandcrew', 'Band Crew');
  const { beacon, relays } = await me.api.createBeacon('Band Test');
  const general = relays.find((r) => r.type === 'text')!;
  const { relay: band } = await me.api.post(`/beacons/${beacon.id}/relays`, { name: 'Staff', type: 'category' });
  await me.api.post(`/beacons/${beacon.id}/relays`, { name: 'secret-plans', type: 'text', parentId: band.id });
  await me.api.post(`/beacons/${beacon.id}/relays`, { name: 'loose-ends', type: 'text' });
  await crew.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);
  const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${general.id}`);
  await expect(theirs.getByRole('link', { name: /secret-plans/ })).toBeVisible();

  // Edit Band › Permissions: @everyone cannot view.
  await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
  await page.getByRole('button', { name: band.name, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Edit / }).click();
  await page.getByRole('button', { name: 'permissions', exact: true }).click();
  await expect(page.getByText(/that are synced with it use these permissions/)).toBeVisible();
  await page.getByRole('button', { name: '@everyone' }).click();
  await setPermission(page, 'View Relays', 'deny');
  await expect(theirs.getByRole('link', { name: /secret-plans/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The relay follows its band until it gets a permission of its own.
  await page.getByRole('link', { name: /secret-plans/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Edit / }).click();
  await page.getByRole('button', { name: 'permissions', exact: true }).click();
  const status = page.getByRole('status').filter({ hasText: 'Permissions' });
  await expect(status).toContainText('synced with');
  await page.getByLabel('Add override target').selectOption({ label: crew.transmitter.username + '#' + crew.transmitter.discriminator });
  await setPermission(page, 'View Relays', 'allow');
  await expect(status).toContainText('not synced');
  await expect(theirs.getByRole('link', { name: /secret-plans/ })).toBeVisible();

  // Sync Now: the band's permissions again.
  await status.getByRole('button', { name: 'Sync Now' }).click();
  await expect(status).not.toContainText('not synced');
  await expect(theirs.getByRole('link', { name: /secret-plans/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Move a loose relay into the band and sync it: hidden too.
  await page.getByRole('link', { name: /loose-ends/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Edit / }).click();
  await page.getByLabel(/^Frequency Band$|^Band$/).selectOption({ label: band.name });
  await page.getByRole('alertdialog', { name: 'Sync permissions' }).getByRole('button', { name: 'Sync Permissions' }).click();
  await expect(theirs.getByRole('link', { name: /loose-ends/ })).toHaveCount(0);
});
