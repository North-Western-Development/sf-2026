import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import ts from 'typescript';
import { test, expect, register, signIn, openAs, promoteToStaff, BASE_URL } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';

test.use({
  launchOptions: { args: MEDIA_ARGS },
  permissions: ['microphone'],
});

/*
 * A developer's Activity, served from a different origin than the app (127.0.0.1:<port> while
 * Subspace is localhost:4173), built with the real @subspace/activity-sdk source. It also frames
 * an "evil" page from yet another origin (localhost:<port>) that tries to talk to Subspace.
 */
const SDK = ts.transpileModule(fs.readFileSync(path.resolve('packages/activity-sdk/src/index.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;

const ACTIVITY_PAGE = `<!doctype html><meta charset="utf-8"><title>Star Counter</title>
<body style="color:#fff;font:14px sans-serif">
<p id="status">loading</p><p id="user"></p><p id="instance"></p>
<ul id="people"></ul>
<p id="messages"></p><p id="code"></p><p id="refused"></p>
<button id="broadcast">Broadcast</button>
<button id="authorize">Sign In</button>
<button id="unknown">Unknown Command</button>
<button id="wrongframe">Wrong Frame</button>
<button id="link">Open Link</button>
<iframe id="evil" style="width:10px;height:10px;border:0"></iframe>
<script type="module">
import { ActivitySdk } from '/sdk.js';
const $ = (id) => document.getElementById(id);
const sdk = new ActivitySdk({ clientId: new URLSearchParams(location.search).get('client'), allowedOrigins: ['${BASE_URL}'] });
const people = (list) => { $('people').innerHTML = ''; for (const p of list) { const li = document.createElement('li'); li.textContent = p.username; $('people').appendChild(li); } };
sdk.on('participants', people);
sdk.on('message', (m) => { $('messages').textContent += JSON.stringify(m.payload); });
await sdk.ready();
$('status').textContent = 'ready';
$('user').textContent = sdk.user.username;
$('instance').textContent = sdk.instance.id;
people(sdk.participants);
$('broadcast').onclick = () => sdk.broadcast({ stars: 7 });
$('authorize').onclick = async () => { try { $('code').textContent = (await sdk.authorize({ scopes: ['identify'] })).code; } catch (e) { $('code').textContent = 'refused:' + e.code; } };
$('unknown').onclick = async () => { try { await sdk['request']('GET_TOKEN', {}, 3000); } catch (e) { $('refused').textContent = e.code; } };
// Right window and origin, but not the frame id Subspace gave us: must be ignored.
$('wrongframe').onclick = () => parent.postMessage({ subspace: 'activity', v: 1, frameId: 'f'.repeat(32), nonce: 'n'.repeat(32), cmd: 'OPEN_EXTERNAL_LINK', args: { url: 'https://wrong-frame.example/' } }, '${BASE_URL}');
$('link').onclick = () => sdk.openExternalLink('https://stars.example/map');
// A page from another origin inside the activity, which learnt the frame id.
$('evil').src = location.href.replace('127.0.0.1', 'localhost').replace(/activity\\.html.*$/, 'evil.html') + location.hash;
</script>`;

const EVIL_PAGE = `<!doctype html><script>
const frameId = new URLSearchParams(location.hash.slice(1)).get('frame_id');
for (const cmd of ['HANDSHAKE', 'OPEN_EXTERNAL_LINK']) {
  window.top.postMessage({ subspace: 'activity', v: 1, frameId, nonce: 'e'.repeat(32), cmd, args: { clientId: 'x', url: 'https://evil.example/' } }, '*');
}
</script>`;

let site: http.Server;
let port = 0;
test.beforeAll(async () => {
  site = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (type: string, body: string) => (res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }), res.end(body));
    if (url.pathname === '/sdk.js') return send('text/javascript', SDK);
    if (url.pathname === '/activity.html') return send('text/html', ACTIVITY_PAGE);
    if (url.pathname === '/evil.html') return send('text/html', EVIL_PAGE);
    res.writeHead(404);
    res.end();
  });
  // Both 127.0.0.1 (the activity) and localhost (the evil page) reach it.
  await new Promise<void>((r) => site.listen(0, r));
  port = (site.address() as AddressInfo).port;
});
test.afterAll(() => site.close());

test.describe('Custom activities', () => {
  test('a developer registers an Activity and staff approve it in the Command Console', async ({ page, me, browser }) => {
    const { application } = await me.api.post('/applications', { name: 'Nebula Quiz' });
    await signIn(page, me);
    await page.getByRole('button', { name: 'User Settings' }).click();
    await page.getByRole('button', { name: 'Developer Applications', exact: true }).click();
    const editor = page.getByRole('listitem', { name: 'Nebula Quiz' });
    await editor.getByRole('button', { name: 'Add Activity' }).click();
    const settings = editor.getByRole('form', { name: 'Activity settings' });
    await settings.getByLabel('Activity URL').fill('http://example.com/quiz');
    await settings.getByRole('button', { name: 'Save Activity' }).click();
    await expect(page.getByText('Activities must be served over https://')).toBeVisible();
    await settings.getByLabel('Activity URL').fill(`http://127.0.0.1:${port}/activity.html?client=${application.id}`);
    await settings.getByRole('button', { name: 'Save Activity' }).click();
    await expect(editor.getByTestId('activity-status')).toHaveText(/Waiting for review/);

    const root = await register('actreviewer', 'Activity Reviewer');
    await promoteToStaff(root, 3);
    const staff = await openAs(browser, root);
    await staff.getByRole('button', { name: 'User Settings' }).click();
    await staff.getByRole('button', { name: 'Command Console' }).click();
    await staff.getByRole('button', { name: 'Activities' }).click();
    const row = staff.getByRole('list', { name: 'Activities waiting for review' }).getByRole('listitem', { name: 'Nebula Quiz' });
    await expect(row).toContainText(`127.0.0.1:${port}/activity.html`);
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(staff.getByRole('list', { name: 'Approved activities' }).getByRole('listitem', { name: 'Nebula Quiz' })).toBeVisible();

    // A new URL sends it back for review.
    await settings.getByLabel('Activity URL').fill(`http://127.0.0.1:${port}/activity.html?client=${application.id}&v=2`);
    await settings.getByRole('button', { name: 'Save Activity' }).click();
    await expect(editor.getByTestId('activity-status')).toHaveText(/Waiting for review/);
    await me.api.delete(`/applications/${application.id}`);
  });

  test('launches in a sandboxed frame on its own origin after the privacy notice, and only its frame is heard', async ({ page, me, browser }) => {
    test.setTimeout(120_000);
    const crew = await register('player', 'Player Two');
    const root = await register('actstaff', 'Activity Staff');
    await promoteToStaff(root, 3);
    const created = await me.api.post('/applications', { name: 'Star Counter' });
    const appId: string = created.application.id;
    const activityUrl = `http://127.0.0.1:${port}/activity.html?client=${appId}`;
    await me.api.put(`/applications/${appId}/activity`, { name: 'Star Counter', description: 'Count stars together', url: activityUrl, maxParticipants: 4 });
    await root.api.put(`/console/activities/${appId}/approval`, {});

    const { beacon, relays } = await me.api.createBeacon('Observatory');
    const comm = relays.find((r) => r.type === 'comm_link')!;
    await crew.api.join(beacon.id, (await me.api.createInvite(beacon.id)).code);

    await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
    await page.getByRole('button', { name: /^Join / }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('main').getByRole('button', { name: 'Start an Activity' }).click();
    await page.getByRole('dialog', { name: 'Activities' }).getByRole('button', { name: 'Star Counter' }).click();

    // The privacy notice comes first; nothing loads before Continue.
    const notice = page.getByRole('dialog', { name: 'Open Star Counter?' });
    await expect(notice).toContainText(`Star Counter by ${me.transmitter.username} will see your username, avatar and who is in this activity.`);
    await expect(notice).toContainText('they can see your IP address');
    await expect(notice).toContainText(`Runs at http://127.0.0.1:${port}`);
    await expect(page.locator('iframe[title="Star Counter"]')).toHaveCount(0);
    await notice.getByRole('button', { name: 'Continue' }).click();

    const stage = page.getByRole('region', { name: 'Star Counter' });
    const iframe = stage.locator('iframe[title="Star Counter"]');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(iframe).toHaveAttribute('credentialless', '');
    const allow = (await iframe.getAttribute('allow'))!;
    expect(allow).toContain("camera 'none'");
    expect(allow).toContain("microphone 'none'");
    const src = new URL((await iframe.getAttribute('src'))!);
    expect(src.origin).toBe(`http://127.0.0.1:${port}`);
    const launch = new URLSearchParams(src.hash.slice(1));
    expect(launch.get('frame_id')).toMatch(/^[0-9a-f]{32}$/);
    expect(launch.get('parent_origin')).toBe(BASE_URL);

    // Handshake: the SDK gets me and the instance.
    const mine = page.frameLocator('iframe[title="Star Counter"]');
    await expect(mine.locator('#status')).toHaveText('ready', { timeout: 15_000 });
    await expect(mine.locator('#user')).toHaveText(me.transmitter.username);
    await expect(mine.locator('#people li')).toHaveCount(1);
    await expect(page.getByTestId('custom-activity')).toHaveAttribute('data-frame-state', 'connected');
    const instanceId = await mine.locator('#instance').textContent();

    // The evil page inside it (another origin) and this page itself are not listened to.
    await expect.poll(async () => Number(await page.getByTestId('custom-activity').getAttribute('data-ignored-messages'))).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.postMessage({ subspace: 'activity', v: 1, frameId: 'x', nonce: 'y', cmd: 'OPEN_EXTERNAL_LINK', args: { url: 'https://self.example/' } }, '*'));
    const before = Number(await page.getByTestId('custom-activity').getAttribute('data-ignored-messages'));
    await mine.locator('#wrongframe').click();
    await expect.poll(async () => Number(await page.getByTestId('custom-activity').getAttribute('data-ignored-messages'))).toBe(before + 1);
    await expect(page.getByRole('dialog', { name: 'Leaving Subspace' })).toHaveCount(0);
    // Unknown commands are refused.
    await mine.locator('#unknown').click();
    await expect(mine.locator('#refused')).toHaveText('UNKNOWN_COMMAND');
    // openExternalLink goes through the usual check.
    await mine.locator('#link').click();
    const leaving = page.getByRole('dialog', { name: 'Leaving Subspace' });
    await expect(leaving).toContainText('https://stars.example/map');
    await leaving.getByRole('button', { name: 'Go Back' }).click();

    // A second person joins from the banner, after their own notice; both frames see both.
    const theirs = await openAs(browser, crew, `/channels/${beacon.id}/${comm.id}`);
    await theirs.context().grantPermissions(['microphone']);
    await theirs.getByRole('button', { name: /^Join / }).click();
    await expect(theirs.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
    const banner = theirs.getByRole('status').filter({ hasText: 'Star Counter' });
    await banner.getByRole('button', { name: 'Join Activity' }).click();
    await theirs.getByRole('dialog', { name: 'Open Star Counter?' }).getByRole('button', { name: 'Continue' }).click();
    const other = theirs.frameLocator('iframe[title="Star Counter"]');
    await expect(other.locator('#status')).toHaveText('ready', { timeout: 15_000 });
    await expect(other.locator('#instance')).toHaveText(instanceId!);
    await expect(other.locator('#people li')).toHaveCount(2);
    await expect(mine.locator('#people li')).toHaveCount(2);
    await expect(mine.locator('#people')).toContainText(crew.transmitter.username);

    // A broadcast reaches the other frame.
    await mine.locator('#broadcast').click();
    await expect(other.locator('#messages')).toHaveText('{"stars":7}');

    // authorize(): Subspace asks them, then the frame gets a code its backend can redeem.
    await other.locator('#authorize').click();
    const consent = theirs.getByRole('dialog', { name: 'Authorize Star Counter' });
    await expect(consent).toContainText('Know your username, tag and avatar');
    await consent.getByRole('button', { name: 'Authorize' }).click();
    await expect(other.locator('#code')).toHaveText(/^[\w-]{40,}$/);
    const code = (await other.locator('#code').textContent())!;
    const token = await fetch(`${BASE_URL}/api/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: appId, client_secret: created.clientSecret }),
    }).then((r) => r.json());
    const who = await fetch(`${BASE_URL}/api/v1/oauth2/@me`, { headers: { authorization: `Bearer ${token.access_token}` } }).then((r) => r.json());
    expect(who.user.id).toBe(crew.transmitter.id);

    // Leaving removes the frame entirely; the other person's frame hears they left.
    await theirs.getByRole('region', { name: 'Star Counter' }).getByRole('button', { name: 'Leave Activity' }).click();
    await expect(theirs.locator('iframe[title="Star Counter"]')).toHaveCount(0);
    await expect(mine.locator('#people li')).toHaveCount(1);
    await stage.getByRole('button', { name: 'Leave Activity' }).click();
    await expect(page.locator('iframe[title="Star Counter"]')).toHaveCount(0);
    await me.api.delete(`/applications/${appId}`);
  });
});
