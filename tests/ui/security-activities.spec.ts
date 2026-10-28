import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { test, expect, register, signIn, promoteToStaff, BASE_URL, type Session } from './fixtures';
import { MEDIA_ARGS } from '../support/fake-voice';

test.use({
  launchOptions: { args: MEDIA_ARGS },
  permissions: ['microphone'],
});

/*
 * A hostile custom Activity speaking the raw postMessage protocol (no SDK), probing the client's
 * bridge in apps/web/src/features/voice/CustomActivity.tsx: commands before the handshake, the wrong
 * clientId, an over-long nonce, oversized commands and broadcasts, unknown scopes, script links,
 * a command flood, and escaping its sandbox (top navigation, reaching into the parent).
 */
const HOSTILE = `<!doctype html><meta charset="utf-8"><title>Probe</title><pre id="out">running</pre><script>
const p = new URLSearchParams(location.hash.slice(1));
const frameId = p.get('frame_id'), parentOrigin = p.get('parent_origin');
const clientId = new URLSearchParams(location.search).get('client');
const waiting = new Map();
addEventListener('message', (e) => {
  const d = e.data;
  if (e.origin !== parentOrigin || !d || d.subspace !== 'host' || !d.nonce) return;
  const r = waiting.get(d.nonce); if (r) { waiting.delete(d.nonce); r(d); }
});
let n = 0;
const send = (cmd, args, nonce = 'n' + (n++) + 'x'.repeat(20), ms = 1500) => new Promise((resolve) => {
  waiting.set(nonce, resolve);
  parent.postMessage({ subspace: 'activity', v: 1, frameId, nonce, cmd, args }, parentOrigin);
  setTimeout(() => { if (waiting.delete(nonce)) resolve({ timeout: true }); }, ms);
});
const code = (r) => r.timeout ? 'TIMEOUT' : r.ok ? 'OK' : r.error.code;
(async () => {
  const out = {};
  out.beforeHandshake = code(await send('BROADCAST', { payload: 1 }));
  out.wrongClient = code(await send('HANDSHAKE', { clientId: '1', v: 1 }));
  out.handshake = code(await send('HANDSHAKE', { clientId, v: 1 }));
  out.longNonce = code(await send('BROADCAST', { payload: 1 }, 'z'.repeat(65), 800));
  out.oversized = code(await send('BROADCAST', { payload: 'x'.repeat(20000) }));
  out.bigBroadcast = code(await send('BROADCAST', { payload: 'x'.repeat(5000) }));
  out.protoScope = code(await send('AUTHORIZE', { scopes: ['toString'] }, undefined, 4000));
  out.badScope = code(await send('AUTHORIZE', { scopes: ['admin'] }));
  out.jsLink = code(await send('OPEN_EXTERNAL_LINK', { url: 'javascript:alert(1)' }));
  out.dataLink = code(await send('OPEN_EXTERNAL_LINK', { url: 'data:text/html,<b>x</b>' }));
  out.unknown = code(await send('GET_TOKEN', {}));
  await new Promise((r) => setTimeout(r, 1100));
  const flood = await Promise.all(Array.from({ length: 30 }, () => send('BROADCAST', { payload: 0 })));
  out.flood = flood.map(code);
  try { out.parentDocument = String(!!parent.document.body); } catch (e) { out.parentDocument = 'blocked'; }
  try { top.location.href = 'https://escaped.example/'; out.topNavigation = 'attempted'; } catch (e) { out.topNavigation = 'blocked'; }
  document.getElementById('out').textContent = JSON.stringify(out);
})();
</script>`;

const importEsm = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
async function cleanup(sessions: Session[]) {
  const { loadNativeEnv } = await importEsm(pathToFileURL(path.resolve(__dirname, '../../scripts/native/env.mjs')).href);
  const { DATABASE_URL } = loadNativeEnv({ test: true });
  if (!/_test(\?|$)/.test(DATABASE_URL)) throw new Error('Refusing to write outside the test database');
  const { Pool } = createRequire(path.resolve(__dirname, '../../packages/database/package.json'))('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const ids = sessions.map((s) => s.transmitter.id);
  await pool.query('DELETE FROM beacons WHERE owner_id = ANY($1::bigint[])', [ids]);
  await pool.query('DELETE FROM oauth_apps WHERE owner_id = ANY($1::bigint[])', [ids]);
  await pool.query('DELETE FROM transmitters WHERE id = ANY($1::bigint[])', [ids]);
  await pool.end();
}

let site: http.Server;
let port = 0;
const made: Session[] = [];
test.beforeAll(async () => {
  site = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/probe.html') return res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }), res.end(HOSTILE);
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => site.listen(0, r));
  port = (site.address() as AddressInfo).port;
});
test.afterAll(async () => {
  site.close();
  await cleanup(made);
});

test('a hostile activity frame is refused at every step of the bridge, and cannot leave its sandbox', async ({ page, me, consoleErrors }) => {
  test.setTimeout(120_000);
  made.push(me);
  const root = await register('actsecstaff', 'Activity Sec Staff');
  made.push(root);
  await promoteToStaff(root, 3);
  const { application } = await me.api.post('/applications', { name: 'Probe' });
  await me.api.put(`/applications/${application.id}/activity`, { name: 'Probe', url: `http://127.0.0.1:${port}/probe.html?client=${application.id}`, maxParticipants: 2 });
  await root.api.put(`/console/activities/${application.id}/approval`, {});
  const { beacon, relays } = await me.api.createBeacon('Probe Bay');
  const comm = relays.find((r) => r.type === 'comm_link')!;

  const dialogs: string[] = [];
  page.on('dialog', (d) => (dialogs.push(d.message()), void d.dismiss()));
  await signIn(page, me, `/channels/${beacon.id}/${comm.id}`);
  await page.getByRole('button', { name: /^Join / }).click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('main').getByRole('button', { name: 'Start an Activity' }).click();
  await page.getByRole('dialog', { name: 'Activities' }).getByRole('button', { name: 'Probe' }).click();
  await page.getByRole('dialog', { name: 'Open Probe?' }).getByRole('button', { name: 'Continue' }).click();

  const frame = page.frameLocator('iframe[title="Probe"]');
  // Authorize with an odd scope may open the consent prompt only for real scopes; cancel anything that appears.
  const consent = page.getByRole('dialog', { name: 'Authorize Probe' });
  void consent.getByRole('button', { name: 'Cancel' }).click({ timeout: 8000 }).catch(() => {});
  await expect(frame.locator('#out')).not.toHaveText('running', { timeout: 30_000 });
  const out = JSON.parse((await frame.locator('#out').textContent())!);

  expect(out.beforeHandshake).toBe('NOT_READY');
  expect(out.wrongClient).toBe('CLIENT_ID_MISMATCH');
  expect(out.handshake).toBe('OK');
  expect(out.longNonce).toBe('TIMEOUT'); // ignored, not answered
  expect(out.oversized).toBe('TOO_LARGE');
  expect(out.bigBroadcast).toBe('TOO_LARGE');
  // 'toString' passes the client's `in SCOPE_TEXT` check (a prototype key) but the API refuses it.
  expect(['INVALID_SCOPE', 'USER_CANCELLED']).toContain(out.protoScope);
  expect(out.badScope).toBe('INVALID_SCOPE');
  expect(out.jsLink).toBe('INVALID_URL');
  expect(out.dataLink).toBe('INVALID_URL');
  expect(out.unknown).toBe('UNKNOWN_COMMAND');
  expect(out.flood).toContain('RATE_LIMITED');
  expect(out.flood.filter((c: string) => c === 'OK').length).toBeLessThanOrEqual(20);
  expect(out.parentDocument).toBe('blocked');
  // No top navigation: the Subspace tab is still where it was.
  expect(page.url()).toContain(`/channels/${beacon.id}/${comm.id}`);
  expect(dialogs).toEqual([]);
  await expect(page.getByRole('dialog', { name: 'Leaving Subspace' })).toHaveCount(0);
  const ignored = Number(await page.getByTestId('custom-activity').getAttribute('data-ignored-messages'));
  expect(ignored).toBeGreaterThanOrEqual(1);
  // Chromium logs the refused top navigation ("...sandboxed, but the flag of 'allow-top-navigation'
  // ... is not set"): that refusal is the point, so it is not a failure here.
  const refused = consoleErrors.filter((e) => /allow-top-navigation/.test(e));
  expect(refused.length).toBeLessThanOrEqual(1);
  for (const e of refused) consoleErrors.splice(consoleErrors.indexOf(e), 1);
  void BASE_URL;
});
