import { test, expect, register, signIn, openAs, promoteToStaff } from './fixtures';

test('a verified bot shows ✓ APP, a webhook HOOK, and Add App only for a public bot', async ({ page, me, browser }) => {
  test.setTimeout(90_000);
  const root = await register('botverifier', 'Bot Verifier');
  await promoteToStaff(root, 3);
  const { beacon, relays } = await me.api.createBeacon('Bot Yard');
  const general = relays.find((r) => r.type === 'text')!.id;

  const { application } = await me.api.post('/applications', { name: 'Helper Bot' });
  const { bot } = await me.api.post(`/applications/${application.id}/bot`);
  await me.api.post(`/beacons/${beacon.id}/bots`, { appId: application.id, permissions: '2048' });
  await me.api.put(`/applications/${application.id}/commands`, { commands: [{ name: 'ping', description: 'Pong' }] }).catch(() => {});
  const asBot = await page.request.post(`/api/v1/channels/relay/${general}/transmissions`, { headers: { authorization: `Bot ${bot.token}` }, data: { content: 'Beep, I am a bot' } });
  expect(asBot.ok()).toBe(true);
  const { webhook } = await me.api.post(`/relays/${general}/webhooks`, { name: 'Deploys' });
  expect((await page.request.post(webhook.url, { data: { content: 'Build passed' } })).ok()).toBe(true);

  await signIn(page, me, `/channels/${beacon.id}/${general}`);
  const log = page.getByRole('log');
  const botPost = log.getByRole('article').filter({ hasText: 'Beep, I am a bot' });
  await expect(botPost.getByTestId('app-tag')).toHaveText('App');
  await expect(log.getByRole('article').filter({ hasText: 'Build passed' }).getByTestId('app-tag')).toHaveText('Hook');

  // Staff verify the bot: the check appears.
  await root.api.patch(`/console/transmitters/${bot.userId}/verified`, { verified: true });
  await page.reload();
  await expect(log.getByRole('article').filter({ hasText: 'Beep, I am a bot' }).getByTestId('app-tag').getByLabel('Verified')).toBeVisible();

  // Its profile, for someone else: no Add App while it is private.
  const other = await register('botfan', 'Bot Fan');
  await other.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);
  const theirs = await openAs(browser, other, `/channels/${beacon.id}/${general}`);
  await theirs.getByRole('log').getByRole('article').filter({ hasText: 'Beep, I am a bot' }).getByRole('button', { name: 'Open profile' }).click();
  const card = theirs.getByRole('dialog', { name: /Helper Bot/ });
  await expect(card.getByTestId('app-tag')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Add App' })).toHaveCount(0);
  await theirs.keyboard.press('Escape');

  await me.api.patch(`/applications/${application.id}/bot`, { isPublic: true });
  await theirs.reload();
  await theirs.getByRole('log').getByRole('article').filter({ hasText: 'Beep, I am a bot' }).getByRole('button', { name: 'Open profile' }).click();
  await expect(theirs.getByRole('dialog', { name: /Helper Bot/ }).getByRole('link', { name: 'Add App' })).toHaveAttribute('href', new RegExp(`client_id=${application.id}&scope=bot`));
});

test('an announcement relay: create it, follow it from another beacon, publish, and the copy arrives', async ({ page, me, browser }) => {
  test.setTimeout(90_000);
  const { beacon: news } = await me.api.createBeacon('Orbital Times');
  const fan = await register('newsfan', 'News Fan');
  await fan.api.join(news.id, (await me.api.createInvite(news.id)).code);
  const { beacon: fanHome, relays: fanRelays } = await fan.api.createBeacon('Fan Base');
  const fanGeneral = fanRelays.find((r) => r.type === 'text')!;

  // Create it from the Create Relay dialog.
  await signIn(page, me, `/channels/${news.id}`);
  await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Orbital Times' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create Relay' }).click();
  const create = page.getByRole('dialog', { name: /Create/ });
  await create.getByRole('radio', { name: /Announcement Relay/ }).click();
  await create.getByLabel(/Relay Name/i).fill('launches');
  await create.getByRole('button', { name: /^Create/ }).click();
  await expect(page.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^launches/ })).toBeVisible();
  const newsRelayId = (await me.api.get(`/beacons/${news.id}/relays`)).relays.find((r: any) => r.name === 'launches').id;

  // The fan follows it into their own beacon.
  const theirs = await openAs(browser, fan, `/channels/${news.id}/${newsRelayId}`);
  await theirs.getByRole('button', { name: 'Follow' }).click();
  const follow = theirs.getByRole('dialog', { name: 'Follow #launches' });
  await follow.getByLabel('Beacon').selectOption({ label: 'Fan Base' });
  await follow.getByLabel('Relay').selectOption({ label: `#${fanGeneral.name}` });
  await follow.getByRole('button', { name: 'Follow' }).click();
  await expect(follow).toBeHidden();

  // Post, then Publish from the context menu.
  await me.api.send(newsRelayId, 'Liftoff at dawn!');
  const post = page.getByRole('log').getByRole('article').filter({ hasText: 'Liftoff at dawn!' });
  await expect(post).toBeVisible();
  await post.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Publish' }).click();
  await expect(page.getByText('Published to 1 following relay')).toBeVisible();
  // Once published, it is not offered again.
  await post.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Publish' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await theirs.goto(`/channels/${fanHome.id}/${fanGeneral.id}`);
  const copy = theirs.getByRole('log').getByRole('article').filter({ hasText: 'Liftoff at dawn!' });
  await expect(copy).toContainText('Orbital Times #launches');
  await expect(copy.getByTestId('app-tag')).toHaveText('Beacon');
});

test('a development team: invite, accept, move an application in, and roles limit what members can do', async ({ page, me, browser }) => {
  test.setTimeout(90_000);
  const dev = await register('teamdev', 'Team Dev');
  const { application } = await me.api.post('/applications', { name: 'Shared App' });

  await signIn(page, me);
  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Developer Applications' }).click();
  await page.getByRole('region', { name: 'Teams' }).getByRole('button', { name: 'New Team' }).click();
  await page.getByRole('dialog', { name: 'Create a Team' }).getByLabel('Team name').fill('Nebula Works');
  await page.getByRole('dialog', { name: 'Create a Team' }).getByRole('button', { name: 'Create' }).click();
  const team = page.getByRole('list', { name: 'Your teams' }).getByRole('listitem', { name: 'Nebula Works' });
  await team.getByLabel('Invite someone').fill(`${dev.transmitter.username}#${dev.transmitter.discriminator}`);
  await team.getByLabel('Role').selectOption('read_only');
  await team.getByRole('button', { name: 'Invite' }).click();
  await expect(team.getByRole('listitem', { name: dev.transmitter.username })).toContainText('invited');
  await page.getByRole('list', { name: 'Your applications' }).getByLabel('Move Shared App to a team').selectOption({ label: 'Nebula Works' });
  await expect(page.getByRole('list', { name: 'Your applications' }).getByRole('listitem', { name: 'Shared App' })).toContainText('Nebula Works · Owner');

  // The invitee accepts, and sees the app read-only.
  const theirs = await openAs(browser, dev);
  await theirs.getByRole('button', { name: 'User Settings' }).click();
  await theirs.getByRole('button', { name: 'Developer Applications' }).click();
  await theirs.getByRole('list', { name: 'Team invitations' }).getByRole('button', { name: 'Accept' }).click();
  const theirApp = theirs.getByRole('list', { name: 'Your applications' }).getByRole('listitem', { name: 'Shared App' });
  await expect(theirApp).toContainText('Nebula Works · Read-only');
  await expect(theirApp.getByRole('button', { name: 'Reset Secret' })).toBeDisabled();
  await expect(theirApp.getByRole('button', { name: `Delete Shared App` })).toHaveCount(0);

  // Made a developer: they can now reset the secret.
  await me.api.patch(`/teams/${(await me.api.get('/teams')).teams[0].id}/members/${dev.transmitter.id}`, { role: 'developer' });
  await theirs.reload();
  await theirs.getByRole('button', { name: 'User Settings' }).click();
  await theirs.getByRole('button', { name: 'Developer Applications' }).click();
  await expect(theirs.getByRole('list', { name: 'Your applications' }).getByRole('listitem', { name: 'Shared App' }).getByRole('button', { name: 'Reset Secret' })).toBeEnabled();
  expect(application.id).toBeTruthy();
});
