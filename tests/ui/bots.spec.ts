import { test, expect, register, signIn, BASE_URL } from './fixtures';
// The bot SDK as a developer would use it, against the test stack.
import { SubspaceBot } from '../../packages/bot-sdk/dist/index.js';

test.describe('bots and slash commands', () => {
  test('a developer adds a bot to their beacon, and members use its slash commands', async ({ page }) => {
    const dev = await register('botdev', 'Bot Dev');
    const { beacon, relays } = await dev.api.createBeacon('Bot Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await signIn(page, dev);

    // Developer Applications: a new app, then its bot (the token shows once).
    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Developer Applications', exact: true }).click();
    await page.getByRole('button', { name: 'New Application' }).click();
    await page.getByRole('dialog', { name: 'Create an Application' }).getByLabel('Name').fill('Helper Bot');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    const card = page.getByRole('listitem', { name: 'Helper Bot' });
    await card.getByRole('button', { name: 'Add Bot' }).click();
    const token = (await page.getByTestId('bot-token').textContent())!.trim();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(card.getByRole('region', { name: 'Bot' })).toContainText('Public Key');
    const invite = (await card.getByTestId('bot-invite').textContent())!.trim();

    // The invite link: pick the beacon, keep the asked-for permissions, Authorize.
    await page.goto(invite.replace(BASE_URL, ''));
    const consent = page.getByRole('region', { name: 'Authorize application' });
    await expect(consent.getByRole('heading', { name: 'Helper Bot' })).toBeVisible();
    await expect(consent.getByRole('list', { name: 'Bot permissions' })).toContainText('Send Transmissions');
    await consent.getByRole('combobox', { name: 'Beacon' }).selectOption({ label: 'Bot Beacon' });
    await consent.getByRole('button', { name: 'Authorize' }).click();
    await page.waitForURL(new RegExp(`/channels/${beacon.id}`));
    await page.goto(`/channels/${beacon.id}/${general.id}`);
    const bots = page.getByRole('complementary', { name: 'Members' });
    await expect(bots.getByRole('button').filter({ hasText: 'Helper Bot' })).toContainText('App');

    // The bot comes online with two commands: one answers everyone, one only the asker.
    const bot = new SubspaceBot({ token, baseUrl: BASE_URL });
    await bot.connect();
    await bot.registerCommands(
      [
        { name: 'echo', description: 'Say it back', options: [{ type: 'string', name: 'text', description: 'What to say', required: true }] },
        { name: 'secret', description: 'Only you see the answer' },
      ],
      beacon.id
    );
    bot.on('interaction', (i) => {
      if (i.commandName === 'echo') void i.reply({ content: `You said: ${i.option<string>('text')}`, embeds: [{ title: 'Echo', color: 0x3353d6, fields: [{ name: 'Length', value: String(i.option<string>('text')!.length), inline: true }] }] });
      else void i.reply({ content: 'psst, just for you', ephemeral: true });
    });

    try {
      await page.reload();
      const box = page.getByRole('textbox', { name: /^Transmit to #/ });
      await box.click();
      await page.keyboard.type('/ec');
      const list = page.getByRole('listbox', { name: 'Commands' });
      await expect(list).toContainText('Helper Bot');
      await expect(list).toContainText('/echo');
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Command options')).toContainText('What to say');
      await page.keyboard.type('hello world');
      await page.keyboard.press('Enter');

      const answer = page.getByRole('article').filter({ hasText: 'You said: hello world' });
      await expect(answer).toBeVisible();
      await expect(answer).toContainText('used /echo');
      await expect(answer).toContainText('App');
      await expect(answer.getByRole('article', { name: 'Embed: Echo' })).toContainText('Length');

      // Ephemeral: shown here, with Dismiss, and never stored.
      await box.click();
      await page.keyboard.type('/secret');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      const whisper = page.getByRole('article').filter({ hasText: 'psst, just for you' });
      await expect(whisper).toContainText('Only you can see this');
      const stored = (await dev.api.get(`/channels/relay/${general.id}/transmissions?limit=5`)).transmissions.map((t: any) => t.content);
      expect(stored).not.toContain('psst, just for you');
      await whisper.getByRole('button', { name: 'Dismiss transmission' }).click();
      await expect(whisper).toHaveCount(0);
    } finally {
      bot.disconnect();
    }
  });

  test('a webhook made in Integrations posts with its own name and a rich embed', async ({ page }) => {
    const me = await register('hookowner', 'Hook Owner');
    const { beacon, relays } = await me.api.createBeacon('Hook Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);

    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Hook Beacon' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Beacon Settings' }).click();
    await page.getByRole('menuitem', { name: 'Beacon Profile', exact: true }).click();
    await page.getByRole('dialog', { name: /Settings/ }).getByRole('button', { name: 'Integrations', exact: true }).click();
    await page.getByRole('button', { name: 'New Webhook' }).click();
    const url = await page.getByTestId('webhook-url').inputValue();
    expect(url).toContain('/api/v1/webhooks/');
    const hook = page.getByRole('listitem', { name: 'Webhook 1' });
    await hook.getByLabel('Webhook name').fill('Deploy Bot');
    await hook.getByLabel('Webhook name').blur();
    await expect(page.getByText('Webhook saved')).toBeVisible();

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Build finished @everyone', embeds: [{ title: 'Build #42', description: 'All **green**', color: '#43B581', footer: { text: 'CI' }, fields: [{ name: 'Branch', value: 'main', inline: true }] }] }),
    });
    expect(res.status).toBeLessThan(300);

    await page.keyboard.press('Escape');
    const post = page.getByRole('article').filter({ hasText: 'Build finished' });
    await expect(post).toContainText('Deploy Bot');
    // Webhooks carry HOOK; bots carry APP.
    await expect(post.getByTestId('app-tag')).toHaveText('Hook');
    const embed = post.getByRole('article', { name: 'Embed: Build #42' });
    await expect(embed).toContainText('Branch');
    await expect(embed).toContainText('CI');
  });
});
