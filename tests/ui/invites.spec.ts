import { test, expect, register, signIn, openAs } from './fixtures';

test.describe('Invite links', () => {
  test('the Copy button puts the link on the clipboard, and pasting it joins the beacon', async ({ page, browser }) => {
    const owner = await register('inviter', 'Inviter');
    const guest = await register('invitee', 'Invitee');
    const { beacon, relays } = await owner.api.createBeacon('Clipboard Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, owner, `/channels/${beacon.id}/${general.id}`);

    await page.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /general/ }).hover();
    await page.getByRole('button', { name: 'Create Invite' }).first().click();
    const link = page.getByRole('textbox', { name: 'Invite link' });
    await expect(link).toHaveValue(/\/invite\/\w+$/);
    const url = await link.inputValue();
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByText('Invite link copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    // The guest pastes it into Join a Beacon (same machine, same clipboard).
    const theirs = await openAs(browser, guest, '/channels/@me');
    await theirs.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await theirs.evaluate((text) => navigator.clipboard.writeText(text), url);
    await theirs.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: /Add a Beacon|Create Beacon/ }).click();
    await theirs.getByRole('button', { name: 'Join a Beacon' }).click();
    const input = theirs.getByLabel(/Invite link/);
    await input.focus();
    await theirs.keyboard.press('Control+V');
    await expect(input).toHaveValue(url);
    // Right-click > Paste does the same.
    await input.fill('');
    await input.click({ button: 'right' });
    await theirs.getByRole('menuitem', { name: /^Paste/ }).click();
    await expect(input).toHaveValue(url);
    await theirs.getByRole('button', { name: 'Join Beacon' }).click();
    await expect(theirs).toHaveURL(new RegExp(`/channels/${beacon.id}/`));
    await theirs.context().close();
  });

  test('when the browser refuses clipboard access, Paste says to use Ctrl+V', async ({ page }) => {
    const me = await register('nopaste', 'No Paste');
    await signIn(page, me, '/channels/@me');
    await page.evaluate(() => {
      navigator.clipboard.readText = () => Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError'));
    });
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: /Add a Beacon|Create Beacon/ }).click();
    await page.getByRole('button', { name: 'Join a Beacon' }).click();
    const input = page.getByLabel(/Invite link/);
    await input.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Paste/ }).click();
    await expect(page.getByText(/Press Ctrl\+V to paste/)).toBeVisible();
    await expect(input).toBeFocused();
  });
});
