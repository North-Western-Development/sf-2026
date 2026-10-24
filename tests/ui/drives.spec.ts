import { test, expect, signIn } from './fixtures';
import type { Page } from '@playwright/test';

// The test stack points every drive at tests/support/mock-drives.ts (started in global setup),
// which approves consent at once and serves the same small tree for each provider.

async function connectDrive(page: Page, name: string) {
  const card = page.getByRole('list', { name: 'Cloud drives' }).getByRole('listitem').filter({ hasText: name });
  const popup = page.waitForEvent('popup');
  await card.getByRole('button', { name: 'Connect' }).click();
  await (await popup).waitForEvent('close');
  await expect(card).toContainText('pilot@');
  return card;
}

test.describe('Cloud drives', () => {
  test('connect Google Drive in the vault, browse folders and import a file', async ({ page, me }) => {
    await signIn(page, me);
    await page.getByRole('complementary').getByRole('button', { name: 'Subspace Vault' }).click();
    const vault = page.getByRole('dialog', { name: 'Subspace Vault' });
    await vault.getByRole('tab', { name: 'Cloud Drives' }).click();

    const card = await connectDrive(page, 'Google Drive');
    await expect(card).toContainText('pilot@gmail.test');
    await card.getByRole('button', { name: 'Browse' }).click();

    const root = vault.getByRole('list', { name: 'Files in Google Drive' });
    await expect(root.getByRole('listitem')).toHaveCount(4);
    await expect(root.getByRole('listitem').filter({ hasText: 'big.bin' })).toBeVisible();

    await root.getByRole('button', { name: 'Mission Logs' }).click();
    await expect(vault.getByRole('list', { name: 'Files in Mission Logs' }).getByText('log.txt')).toBeVisible();
    await vault.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'Google Drive' }).click();

    await vault.getByLabel('Search Google Drive').fill('nebula');
    const results = vault.getByRole('list', { name: 'Files in Google Drive' });
    await expect(results.getByRole('listitem')).toHaveCount(1);

    await results.getByRole('button', { name: 'Import nebula.png' }).click();
    // First vault write: the upload disclaimer, then the import goes through.
    await page.getByRole('dialog', { name: 'Before you upload' }).getByRole('button', { name: 'I understand' }).click();
    await expect(page.getByText('Imported nebula.png')).toBeVisible();

    await vault.getByRole('tab', { name: 'My Files' }).click();
    await expect(vault.getByRole('list', { name: 'Files' }).getByText('nebula.png')).toBeVisible();

    // Disconnect forgets the drive.
    await vault.getByRole('tab', { name: 'Cloud Drives' }).click();
    await vault.getByRole('button', { name: 'Disconnect Google Drive' }).click();
    await page.getByRole('dialog', { name: 'Disconnect Google Drive' }).getByRole('button', { name: 'Disconnect' }).click();
    await expect(card).toContainText('Not connected');
  });

  test('attach a file from Dropbox straight into a transmission', async ({ page, me }) => {
    await me.api.post('/vault/disclaimer/accept');
    const { beacon, relays } = await me.api.createBeacon('Drive Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);

    await page.getByRole('button', { name: 'Add attachment' }).click();
    await page.getByRole('menuitem', { name: 'Attach from Cloud Drive' }).click();
    const picker = page.getByRole('dialog', { name: 'Attach from Cloud Drive' });
    const card = await connectDrive(page, 'Dropbox');
    await card.getByRole('button', { name: 'Browse' }).click();
    await picker.getByRole('button', { name: 'Attach nebula.png' }).click();
    await expect(picker).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Remove nebula.png' })).toBeVisible();
    await page.getByRole('textbox', { name: /^Transmit to #/ }).press('Enter');
    const sent = page.getByRole('log').getByRole('article').last();
    await expect(sent.getByRole('img', { name: 'nebula.png' })).toBeVisible();
  });
});
