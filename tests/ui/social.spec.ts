import { test, expect, register, signIn, openAs } from './fixtures';

test.describe('Affiliates (friends) and direct links (DMs)', () => {
  test('sends a request by tag, the other side accepts it live, both see each other', async ({ page, me, browser }) => {
    const other = await register('friend', 'Friendly Pilot');
    await signIn(page, me);
    const theirs = await openAs(browser, other);
    // Wait until their gateway is ready so the request arrives live.
    await expect(theirs.getByRole('img', { name: 'Online' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Add Affiliate' }).click();
    await page.getByLabel('Transmitter tag').fill(`${other.transmitter.username}#${other.transmitter.discriminator}`);
    await page.getByLabel('Optional note').fill('met you at the station');
    await page.getByRole('button', { name: 'Send Affiliation Request' }).click();
    await expect(page.getByText(/sent|dispatched/i)).toBeVisible();

    const pending = theirs.getByRole('button', { name: /^Pending/ });
    await expect(pending).toContainText('1');
    await pending.click();
    await expect(theirs.getByText('“met you at the station”')).toBeVisible();
    await theirs.getByRole('button', { name: 'Accept' }).click();

    await page.getByRole('button', { name: /^All$/ }).click();
    await expect(page.getByText('Friendly Pilot')).toBeVisible();
    await theirs.getByRole('button', { name: /^All$/ }).click();
    await expect(theirs.getByText(me.transmitter.displayName, { exact: true })).toBeVisible();
    await theirs.context().close();
  });

  test('rejects an unknown tag with an inline error', async ({ page, me }) => {
    await signIn(page, me);
    await page.getByRole('button', { name: 'Add Affiliate' }).click();
    await page.getByLabel('Transmitter tag').fill('nobody_here#0001');
    await page.getByRole('button', { name: 'Send Affiliation Request' }).click();
    await expect(page.getByText(/not find|not found|doesn't exist|didn't work/i)).toBeVisible();
  });

  test('opens a DM from the friends list and exchanges messages in real time', async ({ page, me, browser }) => {
    const other = await register('dm', 'DM Partner');
    await me.api.befriend(other);
    await signIn(page, me);
    const theirs = await openAs(browser, other);
    await expect(theirs.getByRole('img', { name: 'Online' }).first()).toBeVisible();

    await page.getByRole('button', { name: /^All$/ }).click();
    const row = page.getByText('DM Partner', { exact: true }).locator('xpath=ancestor::*[.//button[@aria-label="Message"]][1]');
    await row.getByRole('button', { name: 'Message' }).click();

    const composer = page.getByRole('textbox', { name: 'Transmit to @DM Partner' });
    await composer.fill('psst, private channel');
    await composer.press('Enter');
    await expect(page.getByRole('article').filter({ hasText: 'psst, private channel' })).toBeVisible();

    // Their home button pings and the DM appears in their sidebar with a badge.
    await expect(theirs.getByRole('button', { name: 'Direct Links' })).toContainText('1');
    const dmRow = theirs.getByRole('link').filter({ hasText: me.transmitter.displayName });
    await dmRow.click();
    await expect(theirs.getByRole('article').filter({ hasText: 'psst, private channel' })).toBeVisible();

    const reply = theirs.getByRole('textbox', { name: new RegExp(`Transmit to @${me.transmitter.displayName}`) });
    await reply.fill('copy that');
    await reply.press('Enter');
    await expect(page.getByRole('article').filter({ hasText: 'copy that' })).toBeVisible();
    await theirs.context().close();
  });

  test('a blocked transmitter cannot DM you', async ({ page, me }) => {
    const pest = await register('pest');
    await me.api.befriend(pest);
    await signIn(page, me);
    await page.getByRole('button', { name: /^All$/ }).click();
    const row = page.getByText(pest.transmitter.displayName, { exact: true }).locator('xpath=ancestor::*[.//button[@aria-label="More"]][1]');
    await row.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Block' }).click();
    const confirm = page.getByRole('dialog');
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /Block/ }).click();

    await page.getByRole('button', { name: /^Blocked$/ }).click();
    await expect(page.getByText(pest.transmitter.displayName, { exact: true })).toBeVisible();
    await expect(pest.api.openDm(me, 'let me in')).rejects.toThrow(/403/);
  });
});
