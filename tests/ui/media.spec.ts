import { test, expect, signIn, openAs, register, promoteToStaff } from './fixtures';
import type { Page } from '@playwright/test';

// 1x1 PNGs in two colours, so two uploads are distinct files.
const PNG_RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const PNG_BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');

/** The vault asks once for the upload disclaimer; accept it when it appears. */
async function acceptDisclaimer(page: Page) {
  const notice = page.getByRole('dialog', { name: 'Before you upload' });
  if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: 'I understand' }).click();
}

async function uploadToGallery(page: Page, name: string, body: Buffer, caption: string) {
  await page.getByLabel('Choose media to upload').setInputFiles({ name, mimeType: 'image/png', buffer: body });
  const dialog = page.getByRole('dialog', { name: /^Upload to #/ });
  await expect(dialog.getByRole('img', { name: 'Upload preview' })).toBeVisible();
  await dialog.getByLabel('Caption').fill(caption);
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await page.waitForTimeout(300);
  await acceptDisclaimer(page);
  await expect(dialog).toHaveCount(0);
}

test.describe('Gallery (visual relays)', () => {
  test('uploads with a caption, shows live to other members, and browses in the viewer', async ({ page, me, browser }) => {
    const crew = await register('crew');
    const { beacon } = await me.api.createBeacon('Photo Club');
    const gallery = await me.api.createRelay(beacon.id, 'snapshots', 'visual');
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${gallery.id}`);

    await signIn(page, me, `/channels/${beacon.id}/${gallery.id}`);
    await expect(page.getByRole('heading', { name: 'Welcome to #snapshots!' })).toBeVisible();

    await uploadToGallery(page, 'red.png', PNG_RED, 'Nebula at dawn');
    await uploadToGallery(page, 'blue.png', PNG_BLUE, 'Ice ring');
    const grid = page.getByRole('list', { name: 'Media in #snapshots' });
    await expect(grid.getByRole('button')).toHaveCount(2);

    // The other member sees both without reloading.
    await expect(theirs.getByRole('list', { name: 'Media in #snapshots' }).getByRole('button', { name: 'Nebula at dawn' })).toBeVisible();

    // Newest first; arrow keys move through posts; Escape closes.
    await grid.getByRole('button', { name: 'Ice ring' }).click();
    const viewer = page.getByRole('dialog', { name: 'Ice ring' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Previous' })).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: 'Nebula at dawn' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Nebula at dawn' }).getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'red.png');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Nebula at dawn' })).toHaveCount(0);
    await theirs.context().close();
  });

  test('authors delete their own posts; other members cannot', async ({ page, me, browser }) => {
    const crew = await register('crew');
    const { beacon } = await me.api.createBeacon('Delete Test');
    const gallery = await me.api.createRelay(beacon.id, 'pics', 'visual');
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);

    await signIn(page, me, `/channels/${beacon.id}/${gallery.id}`);
    await uploadToGallery(page, 'red.png', PNG_RED, 'Owner post');

    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${gallery.id}`);
    await theirs.getByRole('button', { name: 'Owner post' }).click();
    await expect(theirs.getByRole('dialog', { name: 'Owner post' })).toBeVisible();
    await expect(theirs.getByRole('dialog', { name: 'Owner post' }).getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await theirs.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Owner post' }).click();
    await page.getByRole('dialog', { name: 'Owner post' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete Post' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to #pics!' })).toBeVisible();
    await expect(theirs.getByRole('button', { name: 'Owner post' })).toHaveCount(0);
    await theirs.context().close();
  });
});

test.describe('Vault', () => {
  test('lists uploads with storage use, filters, and deletes', async ({ page, me }) => {
    const { beacon } = await me.api.createBeacon('Vault Beacon');
    const gallery = await me.api.createRelay(beacon.id, 'drop', 'visual');
    await signIn(page, me, `/channels/${beacon.id}/${gallery.id}`);
    await uploadToGallery(page, 'red.png', PNG_RED, 'For the vault');

    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Direct Links' }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Subspace Vault' }).click();
    const vault = page.getByRole('dialog', { name: 'Subspace Vault' });
    const files = vault.getByRole('list', { name: 'Files' });
    await expect(files.getByText('red.png')).toBeVisible();
    await expect(vault).toContainText(/used/);

    await vault.getByRole('tab', { name: 'Videos' }).click();
    await expect(vault.getByText('No files match')).toBeVisible();
    await vault.getByRole('tab', { name: 'Images' }).click();
    await vault.getByLabel('Search files').fill('red');
    await expect(files.getByText('red.png')).toBeVisible();

    await vault.getByRole('button', { name: 'Delete red.png' }).click();
    await page.getByRole('dialog', { name: 'Delete File' }).getByRole('button', { name: 'Delete' }).click();
    await expect(vault.getByText('No files')).toBeVisible();
  });
});

test.describe('Reports and the Command Console', () => {
  test('a member reports a transmission and staff resolve it in the console', async ({ page, me, browser }) => {
    const troll = await register('troll');
    const { beacon, relays } = await me.api.createBeacon('Report Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    const { code } = await me.api.createInvite(beacon.id);
    await troll.api.join(beacon.id, code);
    await troll.api.send(general.id, 'buy cheap warp cores at totally-legit.example');

    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
    const message = page.getByRole('article').filter({ hasText: 'buy cheap warp cores' });
    await message.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Report Transmission' }).click();
    const report = page.getByRole('dialog', { name: 'Report Transmission' });
    await report.getByRole('radio', { name: /Spam/ }).click();
    await report.getByLabel('Details').fill('Scam link');
    await report.getByRole('button', { name: 'Submit Report' }).click();
    await expect(page.getByRole('dialog', { name: 'Thanks for reporting' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Ordinary members have no console.
    await page.getByRole('button', { name: 'User Settings' }).click();
    await expect(page.getByRole('button', { name: 'Command Console' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    const staff = await register('staff');
    await promoteToStaff(staff);
    const ops = await openAs(browser, staff);
    await ops.getByRole('button', { name: 'User Settings' }).click();
    await ops.getByRole('button', { name: 'Command Console' }).click();
    const reports = ops.getByRole('list', { name: 'Reports' });
    const filed = reports.getByRole('listitem').filter({ hasText: 'Scam link' });
    await expect(filed).toContainText('buy cheap warp cores');
    await filed.getByRole('button', { name: 'Resolve' }).click();
    await expect(filed).toHaveCount(0);

    // Suspend the reported account from the directory.
    await ops.getByRole('button', { name: 'Transmitters', exact: true }).click();
    await ops.getByLabel('Search transmitters').fill(troll.transmitter.username);
    const row = ops.getByRole('list', { name: 'Transmitters' }).getByRole('listitem').filter({ hasText: troll.transmitter.username });
    await row.getByRole('button', { name: 'Suspend' }).click();
    await ops.getByRole('dialog', { name: 'Suspend Transmitter' }).getByRole('button', { name: 'Suspend' }).click();
    await expect(row).toContainText('Suspended');
    await ops.context().close();
  });
});
