import { test, expect, register, signIn, openAs } from './fixtures';

test('Inbox: bookmark and Remind Me from the context menu, Mark Unread, and the four tabs', async ({ page, me }) => {
  test.setTimeout(90_000);
  const friend = await register('inboxpal', 'Inbox Pal');
  const { beacon, relays } = await me.api.createBeacon('Inbox Base');
  const general = relays.find((r) => r.type === 'text')!;
  await friend.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);
  for (const line of ['first note', 'second note', 'third note']) await friend.api.send(general.id, line);

  await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
  const log = page.getByRole('log');
  const second = log.getByRole('article').filter({ hasText: 'second note' });
  await expect(second).toBeVisible();

  // Bookmark and Remind Me.
  await second.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Bookmark' }).click();
  await expect(page.getByText('Bookmarked')).toBeVisible();
  await second.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Remove Bookmark' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Remind Me' }).hover();
  await page.getByRole('menuitem', { name: 'In 1 hour' }).click();

  // Mark Unread: it and everything after it are unread, and stay so while the relay is open.
  await second.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mark Unread' }).click();
  await expect(page.getByText('2 new transmissions')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText('2 new transmissions')).toBeVisible();
  await expect.poll(async () => (await me.api.get('/read-states')).readStates.find((r: any) => r.channelId === general.id)?.lastReadId).toBeTruthy();

  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  const inbox = page.getByRole('dialog', { name: 'Inbox' });
  await expect(inbox.getByRole('region', { name: `Unread in ${general.name}` })).toContainText('second note');
  await inbox.getByRole('tab', { name: 'Bookmarks' }).click();
  await expect(inbox.getByRole('article')).toContainText('second note');
  await inbox.getByRole('tab', { name: 'Reminders' }).click();
  await expect(inbox.getByRole('article')).toContainText('second note');
  await inbox.getByRole('button', { name: 'Mark reminder done' }).click();
  await expect(inbox.getByText('Right-click a transmission and choose Remind Me')).toBeVisible();

  // Mark as read from the Inbox.
  await inbox.getByRole('tab', { name: 'Unreads' }).click();
  await inbox.getByRole('button', { name: `Mark ${general.name} as read` }).click();
  await expect(inbox.getByText('You’re all caught up.')).toBeVisible();
});

test('schedule a transmission: it waits greyed out at the end of the chat, and can be sent now or cancelled', async ({ page, me }) => {
  const { beacon, relays } = await me.api.createBeacon('Scheduling');
  const general = relays.find((r) => r.type === 'text')!;
  await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
  const box = page.getByRole('textbox', { name: /Transmit/ });
  await box.fill('Good morning, crew!');
  await page.getByRole('button', { name: 'Schedule transmission' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule Transmission' });
  await dialog.getByRole('checkbox', { name: /Send when available/ }).check();
  await dialog.getByRole('button', { name: 'Schedule' }).click();
  const feed = page.getByRole('list', { name: 'Scheduled transmissions' });
  await expect(feed.getByRole('listitem', { name: 'Scheduled transmission' })).toContainText('Good morning, crew!');
  await expect(feed).toContainText('sends when available');
  await expect(box).toHaveText('');

  // It lives on this device: still there after a reload.
  await page.reload();
  await expect(page.getByRole('list', { name: 'Scheduled transmissions' })).toContainText('Good morning, crew!');
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByRole('log').getByRole('article').filter({ hasText: 'Good morning, crew!' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Scheduled transmissions' })).toHaveCount(0);
});

test('a long status: two lines, then all of it on hover; answering it quotes it in a Direct Link', async ({ page, me, browser }) => {
  const chatty = await register('chattystatus', 'Chatty Status');
  await chatty.api.befriend(me);
  const status = 'Nobody can check him now! He is charging toward the finish line on a nitro kick, with a very long status';
  await chatty.api.patch('/users/@me/profile', { customStatus: { text: status } });
  const { linkId } = await me.api.openDm(chatty, 'hey');
  await chatty.api.send(linkId, 'hi there').catch(() => chatty.api.post(`/channels/link/${linkId}/transmissions`, { content: 'hi there' }));
  // Online, so their status shows.
  await openAs(browser, chatty, `/channels/@me/${linkId}`);

  await signIn(page, me, `/channels/@me/${linkId}`);
  const theirPost = page.getByRole('log').getByRole('article').filter({ hasText: 'hi there' });
  await theirPost.getByRole('button', { name: 'Open profile' }).click();
  const card = page.getByRole('dialog', { name: /Chatty Status profile/ });
  const bubble = card.getByLabel('Custom status');
  // Clamped for real: two lines tall, not five.
  await expect(bubble).toHaveClass(/line-clamp-2/);
  expect(await bubble.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(60);
  await bubble.hover();
  await expect(bubble).not.toHaveClass(/line-clamp-2/);
  await card.getByRole('button', { name: 'Reply to status' }).click();
  await expect(page.getByRole('textbox', { name: /Transmit/ })).toContainText(`> ${status}`);

  // Notes: a button by the name, for people (yourself too); up to the instance's limit.
  await theirPost.getByRole('button', { name: 'Open profile' }).click();
  const popout = page.getByRole('dialog', { name: /Chatty Status profile/ });
  await popout.getByRole('button', { name: 'Add Note' }).click();
  await expect(popout.getByRole('textbox', { name: 'Note (only you can see this)' })).toBeFocused();
  await expect(popout.getByRole('textbox', { name: 'Note (only you can see this)' })).toHaveAttribute('maxlength', '1024');
});

test('the profile panel beside a Direct Link: Add Note by the name, the note at the bottom, and a setting to hide it', async ({ page, me }) => {
  const pal = await register('notepal', 'Note Pal');
  await pal.api.befriend(me);
  const { linkId } = await me.api.openDm(pal, 'hello');
  await me.api.put(`/users/${pal.transmitter.id}/note`, { note: 'Met at the launch party' });
  await signIn(page, me, `/channels/@me/${linkId}`);
  const panel = page.getByRole('complementary', { name: 'Profile' });
  const note = panel.getByRole('textbox', { name: 'Note (only you can see this)' });
  await expect(note).toHaveValue('Met at the launch party');
  await panel.getByRole('button', { name: 'Edit Note' }).click();
  await expect(note).toBeFocused();

  await page.getByRole('button', { name: 'User Settings' }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('switch', { name: 'Show notes in the profile panel' }).click();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox', { name: 'Note (only you can see this)' })).toHaveCount(0);
  // The button still leads to the note, on the full profile.
  await panel.getByRole('button', { name: 'Edit Note' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Note (only you can see this)' })).toHaveValue('Met at the launch party');
});
