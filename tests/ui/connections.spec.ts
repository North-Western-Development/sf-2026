import { test, expect, register, signIn } from './fixtures';

test('connects GitHub and Steam through their sign-in popups, and shows them on the profile unless hidden', async ({ page }) => {
  const me = await register('linked', 'Linked Pilot');
  const viewer = await register('linkviewer', 'Link Viewer');
  await signIn(page, me);
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();

  for (const name of ['GitHub', 'Steam']) {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: `Connect ${name}` }).click();
    await (await popup).waitForEvent('close');
  }
  const list = page.getByRole('list', { name: 'Your connections' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('pilot-gh');
  await expect(list).toContainText('76561198000004242');

  // Hide Steam from the profile.
  await list.getByRole('listitem').filter({ hasText: 'Steam' }).getByRole('switch', { name: 'Display on profile' }).click();
  await expect.poll(async () => (await viewer.api.get(`/users/${me.transmitter.id}/profile`)).connections.map((c: any) => c.provider)).toEqual(['github']);

  // Disconnect GitHub.
  await page.getByRole('button', { name: 'Disconnect GitHub pilot-gh' }).click();
  await page.getByRole('dialog', { name: 'Disconnect GitHub' }).getByRole('button', { name: 'Disconnect' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
});
