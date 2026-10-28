import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, register, signIn, type Session } from './fixtures';

/*
 * Stored-XSS probes: text other people control (a custom status and its emoji, a beacon's name,
 * an announcement relay's name, the follower webhook named after them, and a private note) is
 * shown as text. Each payload would set window.__xss, open a dialog, or create an <img src=x> /
 * <svg> element if it were ever parsed as HTML.
 */
const IMG = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const SVG = '<svg/onload=window.__xss=1>';
const ATTR = '"><img src=x onerror=alert(1)>';
const LINK = '<a href="javascript:window.__xss=1">click</a>';

const importEsm = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
let pool: any = null;
async function db() {
  if (pool) return pool;
  const { loadNativeEnv } = await importEsm(pathToFileURL(path.resolve(__dirname, '../../scripts/native/env.mjs')).href);
  const { DATABASE_URL } = loadNativeEnv({ test: true });
  if (!/_test(\?|$)/.test(DATABASE_URL)) throw new Error('Refusing to write outside the test database');
  const { Pool } = createRequire(path.resolve(__dirname, '../../packages/database/package.json'))('pg');
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  return pool;
}

/** Remove what these accounts made: beacons (with the webhook authors in them), apps, links, and the accounts. */
async function cleanup(sessions: Session[]) {
  const ids = sessions.map((s) => s.transmitter.id);
  const q = await db();
  await q.query('DELETE FROM transmitters WHERE id IN (SELECT author_id FROM webhooks WHERE beacon_id IN (SELECT id FROM beacons WHERE owner_id = ANY($1::bigint[])))', [ids]);
  await q.query('DELETE FROM beacons WHERE owner_id = ANY($1::bigint[])', [ids]);
  await q.query('DELETE FROM oauth_apps WHERE owner_id = ANY($1::bigint[])', [ids]);
  await q.query('DELETE FROM point_to_point_links WHERE transmitter1_id = ANY($1::bigint[]) OR transmitter2_id = ANY($1::bigint[])', [ids]);
  await q.query('DELETE FROM transmitters WHERE id = ANY($1::bigint[])', [ids]);
}

/** Watch for any sign that a payload ran. */
async function arm(page: Page) {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  return {
    dialogs,
    async assertInert() {
      expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
      expect(dialogs).toEqual([]);
      expect(await page.locator('img[src="x"]').count()).toBe(0);
      expect(await page.locator('svg[onload]').count()).toBe(0);
      expect(await page.locator('[onerror]').count()).toBe(0);
      expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
    },
  };
}

test.describe('Security: hostile text renders as text', () => {
  const made: Session[] = [];
  test.afterAll(async () => {
    await cleanup(made);
    await pool?.end();
  });

  test('custom status (text and emoji) and a private note, in the profile card and DM panel', async ({ page, me }) => {
    made.push(me);
    const evil = await register('xssstatus', 'Status Person');
    made.push(evil);
    await evil.api.patch('/users/@me/profile', { customStatus: { text: `${IMG} ${SVG}`, emoji: SVG } });
    await evil.api.befriend(me);
    const { linkId } = await me.api.openDm(evil, 'hello');
    await evil.api.post(`/channels/link/${linkId}/transmissions`, { content: `${ATTR} ${LINK}` });
    await me.api.put(`/users/${evil.transmitter.id}/note`, { note: `${IMG} ${LINK}` });

    const watch = await arm(page);
    await signIn(page, me, `/channels/@me/${linkId}`);
    const post = page.getByRole('log').getByRole('article').filter({ hasText: 'onerror=alert(1)' });
    await expect(post).toContainText(ATTR);
    await expect(post).toContainText(LINK);

    // The DM's profile panel: the note as a textarea value.
    const panel = page.getByRole('complementary', { name: 'Profile' });
    const note = panel.getByRole('textbox', { name: 'Note (only you can see this)' });
    if (await note.count()) await expect(note).toHaveValue(`${IMG} ${LINK}`);

    // The full card: the status bubble shows the payload as text.
    await post.getByRole('button', { name: 'Open profile' }).click();
    const card = page.getByRole('dialog', { name: /Status Person profile/ });
    await expect(card).toBeVisible();
    await expect(card.getByLabel('Custom status')).toContainText('<img src=x onerror=');
    await page.waitForTimeout(300);
    await watch.assertInert();
  });

  test('beacon and announcement relay names, and the follower webhook named after them', async ({ page, me }) => {
    made.push(me);
    const evil = await register('xssbeacon', 'Beacon Person');
    made.push(evil);
    const { beacon } = await evil.api.createBeacon(`${IMG}`.slice(0, 100));
    const news = (await evil.api.post(`/beacons/${beacon.id}/relays`, { name: '"><svg/onload=alert(1)>', type: 'text', isAnnouncement: true })).relay;
    const invite = await evil.api.createInvite(beacon.id);
    await me.api.join(beacon.id, invite.code);

    const home = await me.api.createBeacon('My Feed');
    const feed = home.relays.find((r) => r.type === 'text')!;
    const follow = await me.api.post(`/relays/${news.id}/followers`, { targetRelayId: feed.id });
    expect(follow.webhook.name).toContain('<img src=x');
    const post = await evil.api.send(news.id, `${LINK} ${ATTR}`);
    await evil.api.post(`/channels/relay/${news.id}/transmissions/${post.id}/publish`);

    const watch = await arm(page);
    // The crosspost in my feed: author name is the source beacon + relay.
    await signIn(page, me, `/channels/${home.beacon.id}/${feed.id}`);
    const copy = page.getByRole('log').getByRole('article').filter({ hasText: 'javascript:window.__xss' });
    await expect(copy).toBeVisible();
    await expect(copy).toContainText('<img src=x onerror=');
    await watch.assertInert();

    // The hostile beacon itself: its name in the header and rail, the relay's name in the list.
    await page.goto(`/channels/${beacon.id}/${news.id}`);
    await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
    await expect(page.getByText('"><svg/onload=alert(1)>').first()).toBeVisible();
    await page.waitForTimeout(300);
    await watch.assertInert();

    // Integrations: the follower webhook in my beacon's settings, named after the hostile beacon.
    const res = await me.api.get(`/relays/${feed.id}/webhooks`);
    expect(res.webhooks.some((w: any) => w.sourceRelayId === news.id)).toBe(true);
  });
});
