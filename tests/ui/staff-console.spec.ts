import { test, expect, register, signIn, promoteToStaff, uniqueName } from './fixtures';
import { PNG } from '../support/mock-drives';

test('root makes a staff rank and a badge, gives both to a member, and the staff log shows it', async ({ page }) => {
  const root = await register('rankroot', 'Rank Root');
  await promoteToStaff(root, 3);
  // A name of its own: earlier runs leave other members in the test database.
  const name = `Rankee ${Date.now().toString(36)}`;
  const member = await register('rankee', name);
  // Ranks and badges outlive a run in the test database: fresh names each time.
  const rank = uniqueName('Helpers').slice(0, 30);
  const badge = uniqueName('Bug Hunter').slice(0, 30);

  await signIn(page, root);
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Command Console' }).click();
  const nav = page.getByRole('navigation').filter({ hasText: 'Staff Ranks' });

  // Staff Ranks: create one that can review reports and quarantine.
  await nav.getByRole('button', { name: 'Staff Ranks', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Staff ranks' }).getByRole('listitem').first()).toContainText('Every permission');
  await page.getByRole('button', { name: 'Create Rank' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create Staff Rank' });
  await dialog.getByLabel('Name').fill(rank);
  await dialog.getByRole('checkbox', { name: /Quarantine/ }).check();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('list', { name: 'Staff ranks' }).getByRole('listitem', { name: rank })).toContainText('Review reports · Quarantine');

  // Badges: create a hand-awarded one with an uploaded icon, and give it to the member.
  await nav.getByRole('button', { name: 'Badges', exact: true }).click();
  await page.getByRole('button', { name: 'Create Badge' }).click();
  dialog = page.getByRole('dialog', { name: 'Create Badge' });
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Upload icon' }).click();
  await (await chooser).setFiles({ name: 'bug.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog.getByRole('button', { name: 'Change icon' })).toBeVisible();
  await dialog.getByLabel('Name').fill(badge);
  await dialog.getByLabel('Description').fill('Found a real bug');
  await dialog.getByRole('button', { name: 'Create' }).click();
  const badgeRow = page.getByRole('list', { name: 'Custom badges' }).getByRole('listitem', { name: badge });
  await expect(badgeRow).toContainText('Given by staff · 0 holders');
  await badgeRow.getByRole('button', { name: 'Holders' }).click();
  dialog = page.getByRole('dialog', { name: `${badge} holders` });
  await dialog.getByLabel('Find someone to give the badge').fill(member.transmitter.username);
  await dialog.getByRole('list', { name: 'Matching transmitters' }).getByRole('button', { name: 'Give' }).click();
  await expect(dialog.getByRole('list', { name: 'Badge holders' })).toContainText(name);
  await page.keyboard.press('Escape');
  await expect(badgeRow).toContainText('1 holder');
  await expect.poll(async () => (await member.api.get(`/users/${member.transmitter.id}/profile`)).commendations.map((c: any) => c.name)).toContain(badge);

  // Transmitters: give the member the new rank.
  await nav.getByRole('button', { name: 'Transmitters', exact: true }).click();
  await page.getByLabel('Search transmitters').fill(member.transmitter.username);
  await page.getByLabel(`Staff rank for ${member.transmitter.username}`).selectOption({ label: rank });
  await expect(page.getByRole('list', { name: 'Transmitters' }).getByRole('listitem', { name })).toContainText(rank);

  // Staff: they are listed under it.
  await nav.getByRole('button', { name: 'Staff', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Staff members' }).getByRole('listitem', { name })).toContainText(rank);

  // Staff Log: every step was recorded.
  await nav.getByRole('button', { name: 'Staff Log', exact: true }).click();
  const log = page.getByRole('list', { name: 'Staff log' });
  await expect(log).toContainText(`Gave ${name} (${member.transmitter.username}#`);
  await expect(log).toContainText(`the ${rank} rank`);
  await expect(log).toContainText(`Created the ${badge} badge`);
  await expect(log).toContainText(`Created the ${rank} rank`);
});
