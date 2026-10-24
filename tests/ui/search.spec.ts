import { test, expect, register, signIn } from './fixtures';
import type { Page } from '@playwright/test';

async function runSearch(page: Page, query: string) {
  const box = page.getByRole('combobox', { name: 'Search' });
  await box.fill(query);
  await box.press('Enter');
  return page.getByRole('complementary', { name: 'Search results' });
}

test.describe('Search', () => {
  test('finds transmissions in a beacon, filters by author, and jumps to old history', async ({ page, me }) => {
    test.setTimeout(90_000);
    const crew = await register('crew', 'Crew Member');
    const { beacon, relays } = await me.api.createBeacon('Search Beacon');
    const general = relays.find((r) => r.type === 'text')!;
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);

    // The oldest hit sits behind a page of newer history, so Jump has to load it.
    await crew.api.send(general.id, 'the quasar map is ready');
    for (let i = 0; i < 60; i++) await me.api.send(general.id, `filler transmission ${i}`);
    await me.api.send(general.id, 'quasar sighting confirmed');

    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);
    await expect(page.getByRole('article').filter({ hasText: 'quasar sighting confirmed' })).toBeVisible();

    const panel = await runSearch(page, 'quasar');
    await expect(panel.getByRole('heading', { name: '2 Results' })).toBeVisible();
    // Newest first, and the member list makes way for the results.
    await expect(panel.getByRole('article').first()).toContainText('quasar sighting confirmed');
    await expect(page.getByRole('complementary', { name: 'Members' })).toHaveCount(0);

    await panel.getByRole('tab', { name: 'oldest' }).click();
    await expect(panel.getByRole('article').first()).toContainText('the quasar map is ready');

    // from: autocompletes members of this beacon.
    const box = page.getByRole('combobox', { name: 'Search' });
    await box.fill('quasar from:Crew');
    await page.getByRole('listbox', { name: 'from suggestions' }).getByRole('option', { name: /Crew Member/ }).click();
    await expect(box).toHaveValue(new RegExp(`quasar from:${crew.transmitter.username}#\\d{4} `));
    await box.press('Enter');
    await expect(panel.getByRole('heading', { name: '1 Result' })).toBeVisible();

    const hit = panel.getByRole('article').first();
    await hit.hover();
    await hit.getByRole('button', { name: 'Jump' }).click();
    const target = page.getByRole('log').getByRole('article').filter({ hasText: 'the quasar map is ready' });
    await expect(target).toBeInViewport({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Close search' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('searches direct links, explains bad filters, and shows an empty state', async ({ page, me }) => {
    const friend = await register('friend', 'Friendly Pilot');
    await me.api.befriend(friend);
    const { linkId } = await friend.api.openDm(me, 'meet at the nebula docks');

    await signIn(page, me, `/channels/@me/${linkId}`);
    const panel = await runSearch(page, 'nebula');
    await expect(panel.getByRole('heading', { name: '1 Result' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Friendly Pilot' })).toBeVisible();

    await runSearch(page, 'nebula from:nobody_here');
    await expect(panel).toContainText('No pilot named "nobody_here"');

    await runSearch(page, 'zzzzunmatched');
    await expect(panel).toContainText('No results found');
  });

  test('never returns transmissions from relays the searcher cannot see', async ({ page, me }) => {
    const crew = await register('crew');
    const { beacon } = await me.api.createBeacon('Secret Beacon');
    const general = (await me.api.get(`/beacons/${beacon.id}/relays`)).relays.find((r: any) => r.type === 'text');
    const secret = await me.api.createRelay(beacon.id, 'command-deck');
    // Deny @everyone VIEW_RELAY on the secret relay.
    const everyone = (await me.api.get(`/beacons/${beacon.id}/clearances`)).clearances.find((c: any) => c.position === 0);
    await me.api.put(`/beacons/${beacon.id}/relays/${secret.id}/overwrites/${everyone.id}`, { targetType: 'clearance', allow: '0', deny: '1' });
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);
    await me.api.send(secret.id, 'launch codes are orbital-seven');
    await me.api.send(general.id, 'launch window opens at noon');

    await signIn(page, crew, `/channels/${beacon.id}/${general.id}`);
    const panel = await runSearch(page, 'launch');
    await expect(panel.getByRole('heading', { name: '1 Result' })).toBeVisible();
    await expect(panel).not.toContainText('orbital-seven');
  });
});
