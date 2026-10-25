import { test, expect, register, signIn } from './fixtures';

test.describe('Engagement', () => {
  test('a new beacon has setup tips, joins get a welcome line to wave at, and the page saves its settings', async ({ page }) => {
    const owner = await register('engowner', 'Eng Owner');
    const { beacon, relays } = await owner.api.createBeacon('Welcome Wagon');
    const general = relays.find((r) => r.type === 'text')!;
    const voice = relays.find((r) => r.type === 'comm_link')!;
    expect(beacon.systemChannelId).toBe(general.id);

    const guest = await register('engguest', 'Eng Guest');
    await guest.api.join(beacon.id, (await owner.api.createInvite(beacon.id)).code);

    await signIn(page, owner, `/channels/${beacon.id}/${general.id}`);
    const log = page.getByRole('log');
    await expect(log.getByRole('note', { name: 'Welcome to Welcome Wagon' })).toBeVisible();
    const join = log.getByRole('note').filter({ hasText: 'Eng Guest' });
    await expect(join).toBeVisible();
    await join.getByRole('button', { name: 'Wave to say hi!' }).click();
    await expect.poll(async () => (await owner.api.get(`/channels/relay/${general.id}/transmissions?limit=1`)).transmissions[0]?.content).toBe('👋');

    // The Engagement page: turn welcomes off, pick defaults and an inactive comm-link.
    await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Welcome Wagon' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Beacon Settings' }).click();
    await page.getByRole('menuitem', { name: 'Engagement' }).click();
    const settings = page.getByRole('dialog', { name: /Settings/ });
    await settings.getByRole('switch', { name: /random welcome message/ }).click();
    await settings.getByRole('radio', { name: /Only @mentions/ }).click();
    await settings.getByRole('combobox', { name: 'Inactive Comm-Link' }).click();
    await settings.getByRole('option', { name: 'General' }).click();
    await settings.getByRole('button', { name: 'Save Changes' }).click();
    await expect.poll(async () => {
      const { beacon: b } = await owner.api.get(`/beacons/${beacon.id}`);
      return [b.welcomeMessages, b.defaultNotifications, b.afkChannelId];
    }).toEqual([false, 'mentions', voice.id]);

    // With welcomes off, a new member joins quietly.
    const quiet = await register('engquiet', 'Eng Quiet');
    await quiet.api.join(beacon.id, (await owner.api.createInvite(beacon.id)).code);
    const last = (await owner.api.get(`/channels/relay/${general.id}/transmissions?limit=1`)).transmissions[0];
    expect(last.type).not.toBe('system_join');
  });
});
