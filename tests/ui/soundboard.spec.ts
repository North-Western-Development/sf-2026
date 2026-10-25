import { test, expect, register, signIn, openAs } from './fixtures';

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  permissions: ['microphone', 'camera'],
});

/** Counts sounds a page starts (default sounds are WebAudio oscillators and noise). */
const countSounds = () => {
  const w = window as any;
  w.__sounds = 0;
  for (const proto of [OscillatorNode.prototype, AudioBufferSourceNode.prototype]) {
    const start = proto.start;
    proto.start = function (...args: any[]) {
      w.__sounds++;
      return start.apply(this, args as any);
    };
  }
};

test.describe('Soundboard', () => {
  test('a sound played in a comm-link is heard by the others in it, not by people outside', async ({ page, me, browser }) => {
    test.setTimeout(90_000);
    const crew = await register('soundcrew', 'Sound Crew');
    const lurker = await register('soundlurk', 'Sound Lurker');
    const { beacon, relays } = await me.api.createBeacon('Sound Beacon');
    const comm = relays.find((r) => r.type === 'comm_link')!;
    const general = relays.find((r) => r.type === 'text')!;
    for (const u of [crew, lurker]) await u.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);

    await page.addInitScript(countSounds);
    await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${comm.id}`);
    await theirs.addInitScript(countSounds);
    await theirs.reload();
    const outside = await openAs(browser, lurker, `/channels/${beacon.id}/${general.id}`);
    await outside.addInitScript(countSounds);
    await outside.reload();

    for (const p of [page, theirs]) {
      await p.getByRole('button', { name: /^Join / }).click();
      await expect(p.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
    }
    const before = await theirs.evaluate(() => (window as any).__sounds);

    await page.getByRole('button', { name: 'Open Soundboard' }).click();
    await page.getByRole('dialog', { name: 'Soundboard' }).getByRole('button', { name: 'Play Ping' }).click();
    await expect.poll(() => theirs.evaluate(() => (window as any).__sounds)).toBeGreaterThan(before);
    expect(await outside.evaluate(() => (window as any).__sounds)).toBe(0);
    for (const p of [theirs, outside]) await p.context().close();
  });
});
