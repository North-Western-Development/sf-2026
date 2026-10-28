import { test, expect, register, signIn, promoteToStaff, uniqueName } from './fixtures';

test('root staff create a storage group, put a member in it, and change a staff rank', async ({ page }) => {
  const root = await register('rootops', 'Root Ops');
  await promoteToStaff(root, 3);
  const member = await register('bigfiles', 'Big Files');
  // Groups outlive a run in the test database: a fresh name each time.
  const group = uniqueName('Creators');

  await signIn(page, root);
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Command Console' }).click();
  await page.getByRole('button', { name: 'Storage Groups', exact: true }).click();
  await expect(page.getByText('500 MB', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create Group' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Storage Group' });
  await dialog.getByLabel('Name').fill(group);
  await dialog.getByLabel('Storage per member (MB)').fill('5120');
  await dialog.getByLabel('Largest upload (MB)').fill('500');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('list', { name: 'Storage groups' }).getByRole('listitem', { name: group })).toContainText('5 GB storage · uploads up to 500 MB · 0 members');

  await page.getByRole('button', { name: 'Transmitters', exact: true }).click();
  await page.getByLabel('Search transmitters').fill(member.transmitter.username);
  await page.getByLabel(`Storage group for ${member.transmitter.username}`).selectOption({ label: group });
  await expect.poll(async () => (await member.api.get('/vault/quota')).storageGroup).toBe(group);
  expect((await member.api.get('/vault/quota')).maxUploadBytes).toBe(500 * 1024 * 1024);

  await page.getByLabel(`Staff rank for ${member.transmitter.username}`).selectOption({ label: 'Moderator' });
  await expect(page.getByRole('list', { name: 'Transmitters' }).getByRole('listitem').filter({ hasText: member.transmitter.username })).toContainText('Moderator');
  // Root cannot change its own rank here.
  await page.getByLabel('Search transmitters').fill(root.transmitter.username);
  await expect(page.getByRole('list', { name: 'Transmitters' }).getByRole('listitem').filter({ hasText: root.transmitter.username })).toBeVisible();
  await expect(page.getByLabel(`Staff rank for ${root.transmitter.username}`)).toHaveCount(0);

  await page.getByRole('button', { name: 'Storage Groups', exact: true }).click();
  await expect(page.getByRole('listitem', { name: group })).toContainText('1 member');
});
