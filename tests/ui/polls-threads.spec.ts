import { test, expect, register, signIn, openAs } from './fixtures';

test('a member posts a poll, another votes, and the results update live', async ({ page, me, browser }) => {
  const voter = await register('voter', 'Poll Voter');
  const { beacon, relays } = await me.api.createBeacon('Poll Beacon');
  const general = relays.find((r) => r.type === 'text')!;
  await voter.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);

  await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
  await page.getByRole('button', { name: 'Add attachment' }).click();
  await page.getByRole('menuitem', { name: 'Create Poll' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a Poll' });
  await dialog.getByLabel('Question').fill('Raid night?');
  await dialog.getByLabel('Answer 1', { exact: true }).fill('Friday');
  await dialog.getByLabel('Answer 2', { exact: true }).fill('Saturday');
  await dialog.getByRole('button', { name: 'Post' }).click();
  const poll = page.getByRole('region', { name: 'Poll: Raid night?' });
  await expect(poll).toContainText('0 votes');

  const theirs = await openAs(browser, voter, `/channels/${beacon.id}/${general.id}`);
  await theirs.getByRole('region', { name: 'Poll: Raid night?' }).getByRole('radio', { name: 'Saturday' }).click();
  await expect(theirs.getByRole('region', { name: 'Poll: Raid night?' })).toContainText('1 vote');
  // Live on my side too.
  await expect(poll).toContainText('1 vote');
  await poll.getByRole('button', { name: 'End Poll' }).click();
  await expect(poll).toContainText('Poll closed');
});

test('slowmode counts down in the box; private threads stay with their members', async ({ page, me, browser }) => {
  const crew = await register('slowcrew', 'Slow Crew');
  const outsider = await register('outsider', 'Not Invited');
  const { beacon, relays } = await me.api.createBeacon('Slow Beacon');
  const general = relays.find((r) => r.type === 'text')!;
  const code = (await me.api.createInvite(beacon.id)).code;
  await crew.api.join(beacon.id, code);
  await outsider.api.join(beacon.id, code);
  await me.api.patch(`/beacons/${beacon.id}/relays/${general.id}`, { slowmodeSeconds: 30 });

  const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${general.id}`);
  const status = theirs.getByRole('status', { name: 'Slowmode' });
  await expect(status).toContainText('one transmission every 30s');
  const box = theirs.getByRole('textbox', { name: /^Transmit to #/ });
  await box.fill('first!');
  await box.press('Enter');
  await expect(status).toContainText(/you can send again in \d+s/);

  // A private thread: the crew member is in it, the outsider never sees it.
  await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
  await page.getByRole('button', { name: 'Threads' }).click();
  await page.getByRole('dialog', { name: 'Threads' }).getByRole('button', { name: 'Private' }).click();
  await page.getByRole('dialog', { name: 'Create Private Thread' }).getByRole('textbox').fill('Surprise Party');
  await page.getByRole('dialog', { name: 'Create Private Thread' }).getByRole('button', { name: 'Create Thread' }).click();
  const pane = page.getByRole('region', { name: 'Thread Surprise Party' });
  await expect(pane).toBeVisible();
  await pane.getByRole('button', { name: 'Add Members' }).click();
  await pane.getByLabel('Add a member to this thread').selectOption({ label: 'Slow Crew' });
  await expect(page.getByText('Added to the thread')).toBeVisible();

  await theirs.getByRole('button', { name: 'Threads' }).click();
  await expect(theirs.getByRole('dialog', { name: 'Threads' })).toContainText('Surprise Party');
  const out = await openAs(browser, outsider, `/channels/${beacon.id}/${general.id}`);
  await out.getByRole('button', { name: 'Threads' }).click();
  await expect(out.getByRole('dialog', { name: 'Threads' })).not.toContainText('Surprise Party');
});
