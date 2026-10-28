import { test, expect, register, signIn, openAs, liveKitTracks } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';

test.use({
  launchOptions: { args: MEDIA_ARGS },
  permissions: ['microphone'],
});

test('a moderator goes live, the audience asks to speak, and an invited speaker is heard', async ({ page, me, browser }) => {
  test.setTimeout(120_000);
  const fan = await register('stagefan', 'Stage Fan');
  const { beacon } = await me.api.createBeacon('Talk Night');
  const { relay: stage } = await me.api.post(`/beacons/${beacon.id}/relays`, { name: 'Main Stage', type: 'stage' });
  await fan.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);

  await signIn(page, me, `/channels/${beacon.id}/${stage.id}`);
  await page.getByRole('button', { name: 'Join Stage' }).click();
  await page.getByRole('button', { name: 'Start Stage' }).click();
  await page.getByRole('dialog', { name: 'Start Stage' }).getByRole('textbox').fill('Ask me anything');
  await page.getByRole('dialog', { name: 'Start Stage' }).getByRole('button', { name: 'Start Stage' }).click();
  await expect(page.getByTestId('stage-topic')).toHaveText('Ask me anything');
  await expect(page.getByRole('list', { name: 'Speakers' }).getByRole('group', { name: me.transmitter.displayName })).toBeVisible();

  const theirs = await openAs(browser, fan, `/channels/${beacon.id}/${stage.id}`);
  await theirs.context().grantPermissions(['microphone']);
  await expect(theirs.getByTestId('stage-topic')).toHaveText('Ask me anything');
  await theirs.getByRole('button', { name: 'Join Stage' }).click();
  // The audience hears the host, who spoke from the start.
  await expect(theirs.getByRole('list', { name: 'Speakers' }).getByRole('group', { name: me.transmitter.displayName })).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
  // The audience cannot unmute; it can ask.
  await expect(theirs.getByRole('main').getByRole('button', { name: 'Mute', exact: true })).toHaveCount(0);
  await theirs.getByRole('button', { name: 'Request to Speak' }).click();

  const fanInAudience = page.getByRole('list', { name: 'Audience' }).getByRole('listitem', { name: 'Stage Fan' });
  await expect(fanInAudience.getByLabel('Requested to speak')).toBeVisible();
  await fanInAudience.getByRole('button', { name: 'Invite Stage Fan to speak' }).click();

  // Now a speaker: their microphone goes out (no reconnect) and the host hears them.
  const fanTile = page.getByRole('list', { name: 'Speakers' }).getByRole('group', { name: 'Stage Fan' });
  await expect(fanTile).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
  await expect(theirs.getByRole('button', { name: 'Move to Audience' })).toBeVisible();
  const mic = async (id: string) => (await liveKitTracks(stage.id))[id] ?? [];
  await expect.poll(() => mic(fan.transmitter.id), { timeout: 20_000 }).toContain('AUDIO/MICROPHONE');
  expect(await mic(me.transmitter.id)).toContain('AUDIO/MICROPHONE');

  // Back to the audience: the microphone is unpublished.
  await theirs.getByRole('button', { name: 'Move to Audience' }).click();
  await expect(page.getByRole('list', { name: 'Audience' }).getByRole('listitem', { name: 'Stage Fan' })).toBeVisible();
  await expect.poll(() => mic(fan.transmitter.id), { timeout: 20_000 }).not.toContain('AUDIO/MICROPHONE');

  // Invited without asking: they are asked first, and speak only once they accept.
  await page.getByRole('list', { name: 'Audience' }).getByRole('listitem', { name: 'Stage Fan' }).getByRole('button', { name: 'Invite Stage Fan to speak' }).click();
  await expect(page.getByRole('list', { name: 'Audience' }).getByRole('listitem', { name: 'Stage Fan' })).toContainText('Invited');
  const ask = theirs.getByRole('alertdialog', { name: 'Invited to speak' });
  await expect(ask).toBeVisible();
  await expect(page.getByRole('list', { name: 'Speakers' }).getByRole('group', { name: 'Stage Fan' })).toHaveCount(0);
  await ask.getByRole('button', { name: 'Join as Speaker' }).click();
  await expect(page.getByRole('list', { name: 'Speakers' }).getByRole('group', { name: 'Stage Fan' })).toBeVisible();
  await expect(ask).toHaveCount(0);
});
