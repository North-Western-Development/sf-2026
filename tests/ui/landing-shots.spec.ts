import path from 'node:path';
import { test, expect, register, signIn, openAs } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';

/**
 * Screenshots for the homepage (apps/web/public/landing), taken from the real app with a made-up
 * crew. Not part of the suite: LANDING_SHOTS=1 npx playwright test tests/ui/landing-shots.spec.ts
 */
test.skip(!process.env.LANDING_SHOTS, 'only when refreshing the homepage screenshots');
test.use({ launchOptions: { args: MEDIA_ARGS }, permissions: ['microphone'], viewport: { width: 1280, height: 760 } });

const OUT = path.resolve(__dirname, '../../apps/web/public/landing');
const shot = (name: string) => path.join(OUT, `${name}.png`);

test('homepage screenshots', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const nova = await register('nova', 'Nova');
  const crew = await Promise.all([register('orion', 'Orion'), register('vega', 'Vega'), register('lyra', 'Lyra'), register('altair', 'Altair')]);
  const [orion, vega, lyra, altair] = crew;

  const { beacon, relays } = await nova.api.createBeacon('Night Shift');
  const general = relays.find((r) => r.type === 'text')!;
  const comm = relays.find((r) => r.type === 'comm_link')!;
  const code = (await nova.api.createInvite(beacon.id)).code;
  for (const c of crew) await c.api.join(beacon.id, code);
  const { relay: lfg } = await nova.api.post(`/beacons/${beacon.id}/relays`, { name: 'looking-for-group', type: 'text' });
  await nova.api.post(`/beacons/${beacon.id}/relays`, { name: 'screenshots', type: 'text' });
  await nova.api.post(`/beacons/${beacon.id}/relays`, { name: 'Lounge', type: 'comm_link' });

  const lines: Array<[typeof nova, string]> = [
    [orion, 'anyone up for a raid tonight? doors at 9'],
    [vega, 'in. bringing snacks and bad decisions'],
    [lyra, 'I can heal if someone carries me through the jumping puzzle 😅'],
    [nova, 'deal. I made a Comm-Link, hop in whenever'],
    [altair, 'running 10 late, save me a spot'],
    [orion, 'also the patch notes dropped, **finally** fixed the grappling hook'],
    [vega, 'no way. I am reinstalling right now'],
  ];
  for (const [who, text] of lines) await who.api.send(general.id, text);
  await orion.api.send(lfg.id, 'LFG: two more for ranked, mid-tier, chill vibes only');
  await lyra.api.send(lfg.id, 'me! give me 5');

  // Part of the crew is online.
  const online = await Promise.all([orion, altair].map((c) => openAs(browser, c, '/channels/@me')));

  // A beacon in full: relays, the conversation, the member list.
  await signIn(page, nova, `/channels/${beacon.id}/${general.id}`);
  await expect(page.getByRole('log').getByRole('article').filter({ hasText: 'reinstalling' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as Read' }).click().catch(() => {});
  await page.mouse.move(640, 740);
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('hero') });
  await page.goto(`/channels/${beacon.id}/${lfg.id}`);
  await expect(page.getByRole('log').getByRole('article').filter({ hasText: 'give me 5' })).toBeVisible();
  await page.screenshot({ path: shot('beacon') });

  // A Comm-Link with someone talking.
  await page.goto(`/channels/${beacon.id}/${comm.id}`);
  await page.getByRole('button', { name: /^Join / }).click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  const theirs = await openAs(browser, vega, `/channels/${beacon.id}/${comm.id}`);
  await theirs.context().grantPermissions(['microphone']);
  await theirs.getByRole('button', { name: /^Join / }).click();
  await expect(page.getByRole('group', { name: 'Vega' })).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
  await page.mouse.move(640, 300);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('comm-link') });
  await theirs.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();
  await theirs.context().close();
  await page.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();

  // An end-to-end encrypted direct link.
  await nova.api.befriend(lyra);
  const { linkId } = await nova.api.openDm(lyra, 'hey, quick question about tonight');
  const lyraPage = await openAs(browser, lyra, `/channels/@me/${linkId}`);
  await page.goto(`/channels/@me/${linkId}`);
  await page.getByRole('button', { name: 'Turn On Encryption' }).click();
  await page.getByRole('dialog', { name: 'Turn on end-to-end encryption?' }).getByRole('button', { name: 'Turn On' }).click();
  await expect(lyraPage.getByRole('button', { name: 'End-to-End Encrypted' })).toBeVisible();
  const say = async (p: typeof page, text: string) => {
    const box = p.getByRole('textbox', { name: /^Transmit to @/ });
    await box.fill(text);
    await box.press('Enter');
  };
  await say(page, 'the surprise party is Saturday, keep it quiet');
  await expect(lyraPage.getByRole('log').getByRole('article').filter({ hasText: 'surprise party' })).toBeVisible({ timeout: 15_000 });
  await say(lyraPage, 'my lips are sealed 🤐 what should I bring?');
  await expect(page.getByRole('log').getByRole('article').filter({ hasText: 'lips are sealed' })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot('private') });
  await lyraPage.context().close();

  // Clearances in Beacon Settings.
  await nova.api.post(`/beacons/${beacon.id}/clearances`, { name: 'Moderators', position: 2, color: '#3DCBFF', permissions: '0' });
  await nova.api.post(`/beacons/${beacon.id}/clearances`, { name: 'Raid Leads', position: 1, color: '#FFF36B', permissions: '0' });
  await page.goto(`/channels/${beacon.id}/${general.id}`);
  await page.getByRole('navigation', { name: 'Beacons' }).getByRole('button', { name: 'Night Shift' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Beacon Settings' }).hover();
  await page.getByRole('menuitem', { name: 'Clearances' }).click();
  await page.getByText('Moderators').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('moderation') });
  for (const p of online) await p.context().close();
});
