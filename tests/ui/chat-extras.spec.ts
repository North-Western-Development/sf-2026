import { test, expect, register, signIn } from './fixtures';

test.describe('Threads, forwarding, inbox, help and apps', () => {
  test('a thread starts from a transmission, opens beside the relay, and its starter counts replies', async ({ page }) => {
    const me = await register('threads', 'Thread Pilot');
    const { beacon, relays } = await me.api.createBeacon('Thread Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await me.api.send(general.id, 'Where should we land?');
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);

    const starter = page.getByRole('article').filter({ hasText: 'Where should we land?' });
    await starter.hover();
    await starter.getByRole('button', { name: 'Create Thread' }).click();
    const prompt = page.getByRole('dialog', { name: 'Create Thread' });
    await prompt.getByLabel('Thread Name').fill('Landing sites');
    await prompt.getByRole('button', { name: 'Create Thread' }).click();

    const pane = page.getByRole('region', { name: 'Thread Landing sites' });
    await expect(pane).toBeVisible();
    await pane.getByRole('textbox', { name: /^Message / }).click();
    await page.keyboard.type('The north pole');
    await page.keyboard.press('Enter');
    await expect(pane.getByRole('article').filter({ hasText: 'The north pole' })).toBeVisible();
    await expect(starter.getByRole('button', { name: 'Open thread Landing sites' })).toContainText('1 Message');

    // The Threads button lists it; closing the pane brings the member list back.
    await pane.getByRole('button', { name: 'Close thread' }).click();
    await expect(pane).toHaveCount(0);
    await page.getByRole('button', { name: 'Threads' }).click();
    await expect(page.getByRole('dialog', { name: 'Threads' })).toContainText('Landing sites');
  });

  test('forwards to a DM, finds mentions in the inbox, shows help, runs /shrug, and keeps spam apart', async ({ page }) => {
    const me = await register('fwd', 'Forward Pilot');
    const friend = await register('fwdfriend', 'Forward Friend');
    const { beacon, relays } = await me.api.createBeacon('Forward Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await friend.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);
    await me.api.post('/links', { targetId: friend.transmitter.id });
    await me.api.send(general.id, 'Coordinates: 42, 7');
    await friend.api.send(general.id, `<@${me.transmitter.id}> are you there?`);

    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
    const msg = page.getByRole('article').filter({ hasText: 'Coordinates: 42, 7' });
    await msg.hover();
    await msg.getByRole('button', { name: 'Forward', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Forward To' });
    await dialog.getByRole('checkbox', { name: 'Forward to Forward Friend' }).check();
    await dialog.getByRole('textbox', { name: 'Add an optional comment' }).fill('for you');
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog).toHaveCount(0);
    const dm = await friend.api.get('/links');
    const linkId = dm.links[0].id;
    const fwd = (await friend.api.get(`/channels/link/${linkId}/transmissions?limit=1`)).transmissions[0];
    expect(fwd).toMatchObject({ content: 'for you', forwarded: { content: 'Coordinates: 42, 7' } });

    // Inbox › Mentions.
    await page.getByRole('button', { name: 'Inbox' }).click();
    const inbox = page.getByRole('dialog', { name: 'Inbox' });
    await inbox.getByRole('tab', { name: 'Mentions' }).click();
    await expect(inbox).toContainText('are you there?');
    await page.keyboard.press('Escape');

    // Help and Ctrl+/.
    await page.getByRole('button', { name: 'Help' }).click();
    await expect(page.getByRole('dialog', { name: 'Help' })).toContainText('Quick Scan');
    await page.getByRole('dialog', { name: 'Help' }).getByRole('tab', { name: 'Formatting' }).click();
    await expect(page.getByRole('dialog', { name: 'Help' }).locator('strong', { hasText: 'bold' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Built-in apps: "/" lists them; /shrug sends.
    const box = page.getByRole('textbox', { name: /^Transmit to #/ });
    await box.click();
    await page.keyboard.type('/shr');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toContainText('/shrug');
    await page.keyboard.press('Enter');
    await page.keyboard.type('oh well');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await me.api.get(`/channels/relay/${general.id}/transmissions?limit=1`)).transmissions[0]?.content).toBe('oh well ¯\\_(ツ)_/¯');

    // Spam: a brand-new account's link goes to the Spam tab.
    const spammer = await register('spammer', 'Spammer');
    await spammer.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);
    await spammer.api.post(`/links/${me.transmitter.id}/transmissions`, { content: 'free credits https://scam.example' });
    await page.goto('/channels/@me/requests');
    await expect(page.getByText('free credits')).toHaveCount(0);
    await page.getByRole('button', { name: 'Spam' }).click();
    await expect(page.getByText('free credits')).toBeVisible();
  });
});
