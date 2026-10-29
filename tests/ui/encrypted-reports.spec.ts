import { test, expect, register, signIn, openAs, promoteToStaff, uniqueName } from './fixtures';
import type { Page } from '@playwright/test';

async function send(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: /^Transmit to @/ });
  await composer.fill(text);
  await composer.press('Enter');
}

async function encryptDm(page: Page) {
  await page.getByRole('button', { name: 'Turn On Encryption' }).click();
  await page.getByRole('dialog', { name: 'Turn on end-to-end encryption?' }).getByRole('button', { name: 'Turn On' }).click();
  await expect(page.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();
}

async function openReports(page: Page) {
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Command Console' }).click();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
}

test.describe('Reports and staff review', () => {
  test('reporting in an encrypted DM warns, shares the transmission with five on each side, and staff see it verified', async ({ page, me, browser }) => {
    test.setTimeout(120_000);
    const friend = await register('harasser', 'Cipher Harasser');
    await me.api.befriend(friend);
    const { linkId } = await me.api.openDm(friend, 'hello before encryption');
    const theirs = await openAs(browser, friend, `/channels/@me/${linkId}`);
    await signIn(page, me, `/channels/@me/${linkId}`);
    await encryptDm(page);
    await expect(theirs.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();

    const tag = Date.now().toString(36);
    const lines = [`calm one ${tag}`, `nasty threat ${tag}`, `calm two ${tag}`];
    for (const line of lines) {
      await send(theirs, line);
      await expect(page.getByRole('log').getByRole('article').filter({ hasText: line })).toBeVisible({ timeout: 15_000 });
    }

    await page.getByRole('log').getByRole('article').filter({ hasText: lines[1] }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Report Transmission' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report Transmission' });
    // The warning: what goes to staff, and that it is in plain text.
    const warning = dialog.getByRole('note', { name: 'Encrypted conversation' });
    await expect(warning).toContainText('up to 5 before and 5 after');
    await expect(warning).toContainText('in plain text');
    const filed = page.waitForRequest((r) => r.url().endsWith('/api/v1/reports') && r.method() === 'POST');
    await dialog.getByRole('button', { name: 'Share and Report' }).click();
    await expect(page.getByRole('dialog', { name: 'Thanks for reporting' })).toBeVisible();
    // What the client sent: the decrypted transmissions, each with its franking key.
    const body = (await filed).postDataJSON();
    expect(body.reveals.map((r: any) => r.text)).toEqual(expect.arrayContaining(lines));
    expect(body.reveals.every((r: any) => /^[A-Za-z0-9_-]{43}$/.test(r.fk))).toBe(true);
    await theirs.context().close();

    // Staff see the conversation, each transmission marked verified.
    const staff = await register('reviewer', 'Report Reviewer');
    await promoteToStaff(staff, 1);
    const review = await openAs(browser, staff);
    await openReports(review);
    const card = review.getByRole('listitem', { name: 'Harassment or abuse report' }).filter({ hasText: lines[1] });
    await expect(card).toContainText('From an end-to-end encrypted conversation');
    const shared = card.getByRole('list', { name: 'Shared conversation' });
    for (const line of lines) await expect(shared).toContainText(line);
    await expect(shared.getByRole('listitem', { name: 'Cipher Harasser: Verified' })).toHaveCount(3);
    await expect(shared).toContainText('Reported');
    await review.context().close();
  });

  test('staff read the beacon a report is about without joining it', async ({ page, me, browser }) => {
    const owner = await register('spamlord', 'Spam Lord');
    const { beacon, relays } = await owner.api.createBeacon(uniqueName('Spam Haven'));
    const general = relays.find((r) => r.type === 'text')!;
    const { code } = await owner.api.createInvite(beacon.id);
    await me.api.join(beacon.id, code);
    const ad = `cheap followers ${Date.now().toString(36)}`;
    const post = (await owner.api.post(`/channels/relay/${general.id}/transmissions`, { content: ad })).transmission;
    await me.api.post('/reports', { targetType: 'transmission', targetId: post.id, reason: 'spam' });

    const staff = await register('beaconreader', 'Beacon Reader');
    await promoteToStaff(staff, 1);
    await signIn(page, staff);
    await openReports(page);
    await page.getByRole('listitem', { name: 'Spam report' }).filter({ hasText: ad }).getByRole('button', { name: 'Read Beacon' }).click();
    const reader = page.getByRole('dialog', { name: `Reading ${beacon.name}` });
    await expect(reader.getByRole('note')).toContainText('members cannot see you here');
    await expect(reader.getByRole('region', { name: 'Transmissions' })).toContainText(ad);
    await expect(reader.getByRole('navigation', { name: 'Relays' })).toContainText(general.name);
    // Never a member: not in the member list.
    const { members } = await owner.api.get(`/beacons/${beacon.id}/members`);
    expect(JSON.stringify(members)).not.toContain(staff.transmitter.id);
  });

  test('screenshot protection is asked for only while an encrypted DM is open', async ({ page, me, browser }) => {
    const friend = await register('privatepal', 'Private Pal');
    await me.api.befriend(friend);
    const { linkId: encrypted } = await me.api.openDm(friend, 'hi');
    const other = await register('plainpal', 'Plain Pal');
    await me.api.befriend(other);
    const { linkId: plain } = await me.api.openDm(other, 'plain hi');

    // The desktop app intercepts the reserved address and cancels the navigation; aborting it here does the same.
    const asks: string[] = [];
    await page.route('https://subspace-desktop.invalid/**', (route) => {
      asks.push(new URL(route.request().url()).searchParams.get('on')!);
      return route.abort('aborted');
    });
    await page.addInitScript(() => {
      (window as any).subspaceDesktop = true;
      (window as any).subspaceDesktopFeatures = ['content-protection'];
    });
    // The friend's app has run once, so they have a device to encrypt to.
    const theirs = await openAs(browser, friend, `/channels/@me/${encrypted}`);
    await signIn(page, me, `/channels/@me/${encrypted}`);
    await encryptDm(page);
    await theirs.context().close();
    await expect.poll(() => asks).toEqual(['1']);
    // Still the same page: the request never navigated away.
    await expect(page.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();
    await page.getByRole('link', { name: /Plain Pal/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/channels/@me/${plain}$`));
    await expect.poll(() => asks).toEqual(['1', '0']);
    await page.getByRole('link', { name: /Private Pal/ }).first().click();
    await expect.poll(() => asks).toEqual(['1', '0', '1']);
  });

  test('the mobile app is asked too, and an older desktop app is never sent the reserved address', async ({ page, me, browser }) => {
    const friend = await register('mobilepal', 'Mobile Pal');
    await me.api.befriend(friend);
    const { linkId } = await me.api.openDm(friend, 'hi');
    // Encrypt from another session first, so this page opens an already-encrypted DM.
    const theirs = await openAs(browser, friend, `/channels/@me/${linkId}`);
    const setup = await openAs(browser, me, `/channels/@me/${linkId}`);
    await encryptDm(setup);
    await setup.context().close();
    await theirs.context().close();

    let navigatedOut = false;
    await page.route('https://subspace-desktop.invalid/**', (route) => {
      navigatedOut = true;
      return route.abort('aborted');
    });
    // An older desktop app (no feature list) and the mobile bridge cannot both be present; check the desktop one first.
    await page.addInitScript(() => ((window as any).subspaceDesktop = true));
    await signIn(page, me, `/channels/@me/${linkId}`);
    await expect(page.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(navigatedOut).toBe(false);

    const phone = await browser.newPage();
    await phone.addInitScript(() => {
      const posts: unknown[] = ((window as any).__posts = []);
      (window as any).subspaceNative = { platform: 'android', push: null, post: (m: unknown) => posts.push(m) };
    });
    await signIn(phone, me, `/channels/@me/${linkId}`);
    await expect.poll(() => phone.evaluate(() => (window as any).__posts.filter((m: any) => m.type === 'secure'))).toEqual([{ type: 'secure', on: true }]);
    await phone.getByRole('link', { name: 'Affiliates' }).first().click();
    await expect.poll(() => phone.evaluate(() => (window as any).__posts.filter((m: any) => m.type === 'secure'))).toEqual([
      { type: 'secure', on: true },
      { type: 'secure', on: false },
    ]);
    await phone.close();
  });
});
