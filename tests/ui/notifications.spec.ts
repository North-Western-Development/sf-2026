import { test, expect, register, signIn, openAs, type Session } from './fixtures';

async function crewedBeacon(owner: Session, name: string) {
  const crew = await register('crew');
  const { beacon, relays } = await owner.api.createBeacon(name);
  const general = relays.find((r) => r.type === 'text')!;
  const other = await owner.api.createRelay(beacon.id, 'off-topic');
  const { code } = await owner.api.createInvite(beacon.id);
  await crew.api.join(beacon.id, code);
  return { crew, beacon, general, other };
}

test.describe('Mentions, unreads and ping markers', () => {
  test('mention autocomplete inserts a real mention that pings the target live', async ({ page, me, browser }) => {
    const { crew, beacon, general, other } = await crewedBeacon(me, 'Ping Beacon');
    // The target sits in another relay so the ping shows up as a badge.
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${other.id}`);
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);

    const composer = page.getByRole('textbox', { name: /^Transmit to #/ });
    await composer.pressSequentially(`hey @${crew.transmitter.username.slice(0, 6)}`);
    await expect(page.getByRole('option', { name: new RegExp(crew.transmitter.username) })).toBeVisible();
    await composer.press('Enter'); // picks the suggestion
    await expect(composer).toHaveValue(new RegExp(`@${crew.transmitter.username}`));
    await composer.press('Enter'); // sends
    await expect(page.getByRole('article').last().getByText(`@${crew.transmitter.username}`)).toBeVisible();

    const relayLink = theirs.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^general/ });
    await expect(relayLink).toHaveAccessibleName(/unread, 1 mentions/);
    await theirs.getByRole('button', { name: 'Direct Links' }).click();
    await expect(theirs.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Ping Beacon, 1 mentions' })).toBeVisible();

    // Opening the relay acknowledges the ping everywhere.
    await theirs.getByRole('button', { name: 'Ping Beacon, 1 mentions' }).click();
    await theirs.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^general/ }).click();
    const mention = theirs.getByRole('article').last();
    await expect(mention).toContainText('hey');
    await expect(theirs.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Ping Beacon' })).toBeVisible();
    await expect(theirs.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^general/ })).not.toHaveAccessibleName(/mentions/);
    await theirs.context().close();
  });

  test('unread relays are marked bold until read, and the state survives a reload', async ({ page, me }) => {
    const { crew, beacon, general, other } = await crewedBeacon(me, 'Unread Beacon');
    await signIn(page, crew, `/channels/${beacon.id}/${other.id}`);
    await me.api.send(general.id, 'nobody has read this yet');

    const link = page.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^general/ });
    await expect(link).toHaveAccessibleName(/, unread/);
    await expect(link).not.toHaveAccessibleName(/mentions/);
    await page.reload();
    await expect(link).toHaveAccessibleName(/, unread/);

    await link.click();
    await expect(page.getByRole('article').filter({ hasText: 'nobody has read this yet' })).toBeVisible();
    await expect(link).not.toHaveAccessibleName(/unread/);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^general/ })).not.toHaveAccessibleName(/unread/);
  });

  test('a muted beacon hides unread but still badges direct mentions, and the mute persists', async ({ page, me }) => {
    const { crew, beacon, general, other } = await crewedBeacon(me, 'Muted Beacon');
    await signIn(page, crew, `/channels/${beacon.id}/${other.id}`);
    const pill = page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: /^Muted Beacon/ });
    await pill.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mute Beacon' }).hover();
    await page.getByRole('menuitem', { name: /Until I turn it back on/ }).click();
    await pill.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Unmute Beacon' })).toBeVisible();
    await page.keyboard.press('Escape');

    await me.api.send(general.id, 'quiet message');
    await me.api.send(general.id, `<@${crew.transmitter.id}> direct ping still counts`);
    // Muting hides unread, but a direct mention still badges the beacon (Discord behaviour).
    await expect(pill).toHaveAccessibleName('Muted Beacon, 1 mentions');
    await expect(page.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^general/ })).not.toHaveAccessibleName(/unread/);

    // The mute is stored server-side.
    await page.reload();
    await pill.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Unmute Beacon' })).toBeVisible();
  });
});
