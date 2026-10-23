import { test, expect, register, signIn, openAs } from './fixtures';

test.describe('Beacon folders (clusters)', () => {
  test('dragging one beacon onto another makes a folder that persists, opens and ungroups', async ({ page, me }) => {
    await me.api.createBeacon('Alpha Quadrant');
    await me.api.createBeacon('Beta Quadrant');
    await signIn(page, me);
    const rail = page.getByRole('navigation', { name: 'Beacons' });

    await rail.getByRole('button', { name: 'Alpha Quadrant' }).dragTo(rail.getByRole('button', { name: 'Beta Quadrant' }));
    const folder = rail.getByRole('button', { name: / cluster$/ });
    await expect(folder).toBeVisible();
    await expect(folder).toHaveAttribute('aria-expanded', 'false');
    await expect(rail.getByRole('button', { name: 'Alpha Quadrant' })).toHaveCount(0);

    await folder.click();
    await expect(folder).toHaveAttribute('aria-expanded', 'true');
    await expect(rail.getByRole('button', { name: 'Alpha Quadrant' })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Beta Quadrant' })).toBeVisible();

    // Rename from the folder's context menu.
    await folder.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename Cluster' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename Cluster' });
    await rename.getByRole('textbox').fill('Gamma Sector');
    await rename.getByRole('button', { name: /Save|Done|Rename/ }).click();
    await expect(rail.getByRole('button', { name: 'Gamma Sector cluster' })).toBeVisible();

    await page.reload();
    await expect(rail.getByRole('button', { name: 'Gamma Sector cluster' })).toBeVisible();

    await rail.getByRole('button', { name: 'Gamma Sector cluster' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Ungroup Cluster' }).click();
    await expect(rail.getByRole('button', { name: / cluster$/ })).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'Alpha Quadrant' })).toBeVisible();
  });

  test('a folder sums the mentions of the beacons inside it', async ({ page, me }) => {
    const owner = await register('owner');
    const { beacon: a, relays } = await owner.api.createBeacon('Ping Alpha');
    const { code } = await owner.api.createInvite(a.id);
    await me.api.join(a.id, code);
    const { beacon: b } = await me.api.createBeacon('Quiet Beta');
    await me.api.post('/clusters', { name: 'Work', color: '#3B8EF2', beaconIds: [a.id, b.id] });

    await signIn(page, me);
    await expect(page.getByRole('img', { name: 'Online' }).first()).toBeVisible();
    await owner.api.send(relays.find((r) => r.type === 'text')!.id, `<@${me.transmitter.id}> report in`);
    const folder = page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Work cluster' });
    await expect(folder.getByText('1')).toBeVisible();
  });
});

test.describe('Beacon administration', () => {
  test('owner renames the beacon and creates a relay; members see both live', async ({ page, me, browser }) => {
    const crew = await register('crew');
    const { beacon, relays } = await me.api.createBeacon('Old Name');
    const general = relays.find((r) => r.type === 'text')!;
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${general.id}`);
    await signIn(page, me, `/channels/${beacon.id}/${general.id}`);

    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Old Name' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Create Relay' }).click();
    const create = page.getByRole('dialog', { name: /Create/ });
    await create.getByLabel(/Relay Name/i).fill('Engineering Bay');
    await create.getByRole('button', { name: /^Create/ }).click();
    await expect(page.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^engineering-bay/ })).toBeVisible();
    await expect(theirs.getByRole('navigation', { name: 'Relays' }).getByRole('link', { name: /^engineering-bay/ })).toBeVisible();

    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Old Name' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Beacon Settings' }).click();
    const settings = page.getByRole('dialog', { name: /Settings/ });
    await settings.getByLabel('Beacon Name').fill('New Name');
    await settings.getByRole('button', { name: 'Save Changes' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'New Name' })).toBeVisible();
    await expect(theirs.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'New Name' })).toBeVisible();
    await theirs.context().close();
  });

  test('an invite link lets a new pilot join through the invite page', async ({ page, me }) => {
    const { beacon } = await me.api.createBeacon('Open Doors');
    const { code } = await me.api.createInvite(beacon.id);
    const newbie = await register('newbie');
    await signIn(page, newbie, `/invite/${code}`);
    await expect(page.getByText('Open Doors')).toBeVisible();
    await page.getByRole('button', { name: /Accept|Join/ }).click();
    await expect(page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Open Doors' })).toHaveAttribute('aria-current', 'page');
  });

  test('members without clearance do not get admin actions', async ({ page, me }) => {
    const crew = await register('crew');
    const { beacon, relays } = await me.api.createBeacon('Locked Down');
    const { code } = await me.api.createInvite(beacon.id);
    await crew.api.join(beacon.id, code);
    await signIn(page, crew, `/channels/${beacon.id}/${relays.find((r) => r.type === 'text')!.id}`);
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Locked Down' }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Beacon Settings' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Create Relay' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Leave Beacon' })).toBeVisible();
    // The API agrees.
    await expect(crew.api.patch(`/beacons/${beacon.id}`, { name: 'Hijacked' })).rejects.toThrow(/403/);
  });
});

test.describe('Forum relays', () => {
  test('creates a post with tags, replies in it, and finds it by search', async ({ page, me }) => {
    const { beacon } = await me.api.createBeacon('Forum Beacon');
    const forum = await me.api.createRelay(beacon.id, 'ideas', 'archival');
    await signIn(page, me, `/channels/${beacon.id}/${forum.id}`);

    await page.getByRole('button', { name: 'New Post' }).click();
    const dialog = page.getByRole('dialog', { name: 'New post in #ideas' });
    await dialog.getByLabel(/^Title/).fill('Warp core upgrade');
    await dialog.getByLabel('Opening transmission').fill('We should **upgrade** the warp core.');
    await dialog.getByLabel('New tag').fill('engineering');
    await dialog.getByLabel('New tag').press('Enter');
    await dialog.getByRole('button', { name: 'Post' }).click();

    const post = page.getByRole('region', { name: 'Warp core upgrade' });
    await expect(post).toBeVisible();
    await expect(post.locator('strong', { hasText: 'upgrade' })).toBeVisible();
    const reply = post.getByRole('textbox');
    await reply.fill('Agreed, scheduling it');
    await reply.press('Enter');
    await expect(post.getByRole('article').filter({ hasText: 'Agreed, scheduling it' })).toBeVisible();
    await post.getByRole('button', { name: 'Close post' }).click();

    await page.getByLabel('Search posts').fill('warp');
    await expect(page.getByText('Warp core upgrade')).toBeVisible();
    await page.getByLabel('Search posts').fill('nothing-matches-this');
    await expect(page.getByText('Warp core upgrade')).toHaveCount(0);
  });
});
