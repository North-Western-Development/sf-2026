import { test, expect, register, signIn, openAs } from './fixtures';

test.describe('Moderation pages', () => {
  test('AutoMod blocks what a rule names, the Audit Log shows it, and Safety Setup pauses invites', async ({ page, browser }) => {
    const owner = await register('modowner', 'Mod Owner');
    const member = await register('modmember', 'Mod Member');
    const { beacon, relays } = await owner.api.createBeacon('Watched Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await member.api.join(beacon.id, (await owner.api.createInvite(beacon.id)).code);

    // Owner sets up a custom words rule from the AutoMod page.
    await signIn(page, owner, `/channels/${beacon.id}/${general.id}`);
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Watched Beacon' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Beacon Settings' }).click();
    await page.getByRole('menuitem', { name: 'AutoMod' }).click();
    const settings = page.getByRole('dialog', { name: /Settings/ });
    const custom = settings.getByRole('region', { name: 'Block Custom Words' });
    await custom.getByRole('button', { name: 'Set Up' }).click();
    await custom.getByRole('textbox', { name: 'Blocked words' }).fill('pineapple*, anchovies');
    await custom.getByRole('textbox', { name: 'Custom block message' }).fill('Pizza opinions are banned.');
    await custom.getByRole('button', { name: 'Save Rule' }).click();
    await expect(page.getByText('Rule saved')).toBeVisible();

    // The member is stopped with the rule's message, and nothing posts.
    const theirs = await openAs(browser, member, `/channels/${beacon.id}/${general.id}`);
    const box = theirs.getByRole('textbox', { name: /^Transmit to #/ });
    await box.click();
    await theirs.keyboard.type('pineapple belongs on pizza');
    await theirs.keyboard.press('Enter');
    await expect(theirs.getByText('Pizza opinions are banned.')).toBeVisible();
    await expect(theirs.getByRole('log').getByText('pineapple belongs on pizza')).toHaveCount(0);
    await theirs.context().close();

    // The Audit Log lists the rule and the block.
    await settings.getByRole('button', { name: 'Audit Log' }).click();
    const log = settings.getByRole('list', { name: 'Audit log entries' });
    await expect(log).toContainText('created the AutoMod rule Custom Words 1');
    await expect(log).toContainText('blocked a transmission from');

    // Safety Setup: pause invites, and joining stops.
    await settings.getByRole('button', { name: 'Safety Setup' }).click();
    await settings.getByRole('button', { name: 'Pause', exact: true }).first().click();
    await expect(settings.getByText(/Paused until/)).toBeVisible();
    const stranger = await register('modstranger', 'Stranger');
    const { code } = await owner.api.createInvite(beacon.id);
    await expect(stranger.api.join(beacon.id, code)).rejects.toThrow(/403/);
  });
});
