import { test, expect, register, signIn, promoteToStaff } from './fixtures';
import { DEFAULT_DEVELOPER_POLICY } from '@subspace/constants';

test('staff set the developer policy and verify accounts by hand', async ({ page }) => {
  const root = await register('devpolicy', 'Dev Policy');
  await promoteToStaff(root, 3);
  const dev = await register('handverify', 'Hand Verify');

  await signIn(page, root);
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Command Console' }).click();
  await page.getByRole('button', { name: 'Developers', exact: true }).click();

  // The policy is instance-wide and other tests run alongside: change only what affects nobody
  // while everything stays open (what counts as verified), and put the defaults back after.
  try {
    const verified = page.getByRole('group', { name: 'Verified accounts' });
    await verified.getByRole('checkbox', { name: /Verified email/ }).uncheck();
    await expect(page.getByText('Verified here means a verified phone number or verification by staff.')).toBeVisible();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect.poll(async () => (await root.api.get('/console/developer-policy')).policy.verifiedBy).toEqual(['phone', 'staff']);
    // The last way to be verified cannot be unticked.
    await verified.getByRole('checkbox', { name: /Verified phone number/ }).uncheck();
    await expect(verified.getByRole('checkbox', { name: /Verified by staff/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(verified.getByRole('checkbox', { name: /Verified phone number/ })).toBeChecked();
  } finally {
    await root.api.put('/console/developer-policy', DEFAULT_DEVELOPER_POLICY);
  }

  // Verified by hand in Transmitters.
  await page.getByRole('button', { name: 'Transmitters', exact: true }).click();
  await page.getByLabel('Search transmitters').fill(dev.transmitter.username);
  const row = page.getByRole('list', { name: 'Transmitters' }).getByRole('listitem', { name: 'Hand Verify' });
  await expect(row).toContainText('Verified email');
  await row.getByRole('button', { name: `Verify ${dev.transmitter.username}` }).click();
  await expect(row.getByText('Verified', { exact: true })).toBeVisible();
  expect((await dev.api.get('/applications/policy')).verification.staff).toBe(true);
  await row.getByRole('button', { name: `Unverify ${dev.transmitter.username}` }).click();
  await expect(row.getByText('Verified', { exact: true })).toHaveCount(0);
});

test('Developer Applications explains what this instance needs before you can build', async ({ page, me }) => {
  // How it looks on an instance that keeps apps and Message Content for verified accounts.
  await page.route('**/api/v1/applications/policy', (route) =>
    route.fulfill({
      json: {
        verification: { email: true, phone: false, staff: false, verified: false },
        verifiedMeans: 'a verified phone number or verification by staff',
        createApps: { allowed: false, missing: ['a verified phone number or verification by staff'] },
        intents: { messageContent: { allowed: false, audience: 'verified' }, activity: { allowed: true, audience: 'everyone' } },
      },
    })
  );
  const { application } = await me.api.post('/applications', { name: 'Older App' });
  await me.api.post(`/applications/${application.id}/bot`);
  await signIn(page, me);
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Developer Applications' }).click();
  await expect(page.getByRole('note')).toContainText('Creating applications on this instance needs a verified phone number or verification by staff');
  await expect(page.getByRole('button', { name: 'New Application' })).toBeDisabled();

  const bot = page.getByRole('region', { name: 'Bot' });
  await expect(bot.getByRole('checkbox', { name: /Message Content Intent/ })).toBeDisabled();
  await expect(bot).toContainText('On this instance it needs a verified account: a verified phone number or verification by staff.');
  // It flips once the server has saved it.
  await bot.getByRole('checkbox', { name: /Activity Status Intent/ }).click();
  await expect(bot.getByRole('checkbox', { name: /Activity Status Intent/ })).toBeChecked();
  await expect.poll(async () => (await me.api.get(`/applications/${application.id}/bot`)).bot.activityIntent).toBe(true);
});
