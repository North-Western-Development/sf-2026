import { test, expect, register, signIn, uniqueName } from './fixtures';

test.describe('Discover', () => {
  test('the sidebar lists categories, and each shows only the beacons listed in it', async ({ page }) => {
    const owner = await register('lister', 'Beacon Lister');
    const games = uniqueName('Frag Hall');
    const tunes = uniqueName('Tune Bay');
    const g = (await owner.api.createBeacon(games)).beacon;
    const t = (await owner.api.createBeacon(tunes)).beacon;
    await owner.api.patch(`/beacons/${g.id}`, { isDiscoverable: true, discoveryCategory: 'gaming' });
    await owner.api.patch(`/beacons/${t.id}`, { isDiscoverable: true, discoveryCategory: 'music' });
    // Only the fixed categories are accepted.
    await expect(owner.api.patch(`/beacons/${t.id}`, { discoveryCategory: 'warez' })).rejects.toThrow(/400/);

    const visitor = await register('browser', 'Discover Browser');
    await signIn(page, visitor, '/discover');
    const categories = page.getByRole('navigation', { name: 'Discover categories' });
    for (const name of ['Home', 'Gaming', 'Music', 'Entertainment', 'Science & Tech', 'Education']) await expect(categories.getByRole('link', { name })).toBeVisible();
    await expect(categories.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    // Home lists both (newer test runs add more, so search for these two).
    const search = page.getByRole('textbox', { name: 'Search beacons' });
    await search.fill(games);
    await expect(page.getByRole('article').filter({ hasText: games })).toBeVisible();
    await search.fill('');

    await categories.getByRole('link', { name: 'Gaming' }).click();
    await expect(page).toHaveURL(/\/discover\?category=gaming$/);
    await expect(page.getByRole('heading', { name: 'Gaming' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: games })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: tunes })).toHaveCount(0);

    await categories.getByRole('link', { name: 'Music' }).click();
    await expect(page.getByRole('article').filter({ hasText: tunes })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: games })).toHaveCount(0);
  });

  test('beacon settings pick the category once the beacon is discoverable', async ({ page }) => {
    const owner = await register('setcat', 'Category Setter');
    const { beacon } = await owner.api.createBeacon(uniqueName('Study Hall'));
    await signIn(page, owner, `/channels/${beacon.id}`);
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: beacon.name }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Beacon Settings' }).click();
    await page.getByRole('menuitem', { name: 'Beacon Profile', exact: true }).click();
    const settings = page.getByRole('dialog', { name: /Settings/ });
    await expect(settings.getByRole('combobox', { name: 'Discover category' })).toHaveCount(0);
    await settings.getByRole('switch', { name: 'Discoverable' }).click();
    await settings.getByRole('combobox', { name: 'Discover category' }).selectOption('education');
    await settings.getByRole('button', { name: 'Save Changes' }).click();
    await expect.poll(async () => (await owner.api.get(`/beacons/${beacon.id}`)).beacon.discoveryCategory).toBe('education');
  });
});
