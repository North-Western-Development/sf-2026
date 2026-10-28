import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import WebSocket from 'ws';

/**
 * Live smoke tests: run against a real deployment through its public edge, the way people use
 * it. See playwright.live.config.ts. Everything created here is deleted at the end.
 */

const BASE = process.env.LIVE_URL!.replace(/\/$/, '');
const HTTPS = BASE.startsWith('https://');

interface Account {
  token: string;
  refresh: string;
  user: { id: string; username: string; displayName: string };
  api: APIRequestContext;
  /** Set for an account this run registered (and so deletes at the end). */
  password?: string;
}

async function account(n: 1 | 2): Promise<Account> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  const email = process.env[n === 1 ? 'LIVE_EMAIL' : 'LIVE_EMAIL_2'];
  const password = process.env[n === 1 ? 'LIVE_PASSWORD' : 'LIVE_PASSWORD_2'];
  let body: any;
  let created: string | undefined;
  if (email && password) {
    const res = await ctx.post('/api/v1/auth/login', { data: { username: email, password } });
    expect(res.ok(), await res.text()).toBe(true);
    body = await res.json();
  } else {
    const username = `live_${Date.now().toString(36)}_${n}`;
    created = `live-smoke-${Date.now()}-pw`;
    const res = await ctx.post('/api/v1/auth/register', {
      data: { username, email: `${username}@live-smoke.invalid`, password: created, displayName: `Live Smoke ${n}`, acceptDirectives: true },
    });
    expect(res.ok(), `register: ${await res.text()}`).toBe(true);
    body = await res.json();
  }
  const api = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: `Bearer ${body.accessToken}` } });
  return { token: body.accessToken, refresh: body.refreshToken, user: body.transmitter, api, password: created };
}

/** Content-Security-Policy violations seen by signed-in pages; the suite fails on any. */
const cspViolations: string[] = [];

async function signedInPage(page: Page, a: Account, path: string) {
  page.on('console', (m) => {
    if (/Content.Security.Policy/i.test(m.text())) cspViolations.push(m.text());
  });
  // Keep every peer connection, to see which network path the media took.
  await page.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    const all: RTCPeerConnection[] = ((window as any).__pcs = []);
    window.RTCPeerConnection = function (this: any, ...args: any[]) {
      const pc = new (Native as any)(...args);
      all.push(pc);
      return pc;
    } as any;
    window.RTCPeerConnection.prototype = Native.prototype;
  });
  // The cookie notice sits over the bottom of the window (the browser suite checks it).
  await page.addInitScript(() => localStorage.setItem('subspace:cookie-notice', '1'));
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('live-signed-in')) return;
    sessionStorage.setItem('live-signed-in', '1');
    localStorage.setItem('subspace_access_token', s.token);
    localStorage.setItem('subspace_refresh_token', s.refresh);
    localStorage.setItem('subspace_user', JSON.stringify(s.user));
  }, { token: a.token, refresh: a.refresh, user: a.user });
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
}

test.describe.serial('Live instance smoke test', () => {
  let one: Account;
  let two: Account;
  let beaconId = '';
  let textId = '';
  let commId = '';

  test.beforeAll(async () => {
    one = await account(1);
    two = await account(2);
  });

  test.afterAll(async () => {
    if (beaconId) await one.api.delete(`/api/v1/beacons/${beaconId}`).catch(() => {});
    // Accounts this run registered go too, so runs do not pile up in the Command Console.
    for (const a of [one, two]) {
      if (a?.password) await a.api.post('/api/v1/auth/me/delete', { data: { password: a.password } }).catch(() => {});
    }
  });

  test('the edge serves the app and the API, with security headers', async ({ request }) => {
    const home = await request.get('/');
    expect(home.ok()).toBe(true);
    expect(await home.text()).toContain('<div id="root">');
    // Deployed behind the nginx edge and TLS (a local dev server has neither).
    if (HTTPS) {
      expect(home.headers()['x-content-type-options']).toBe('nosniff');
      expect(home.headers()['strict-transport-security']).toMatch(/max-age=\d+/);
    }

    const info = await request.get('/api/v1/system/info');
    expect(info.ok()).toBe(true);
    expect(await info.json()).toBeTruthy();
    expect((await request.get('/api/v1/auth/me')).status()).toBe(401);
  });

  test('the gateway WebSocket accepts an authenticated session', async () => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/gateway`);
    const events: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no READY within 15s')), 15_000);
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        events.push(msg);
        if (msg.op === 10) ws.send(JSON.stringify({ op: 2, d: { token: one.token } }));
        if (msg.t === 'READY') {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on('error', reject);
    });
    expect(events.find((e) => e.t === 'READY').d.transmitter.id).toBe(one.user.id);
    ws.close();
  });

  test('a beacon, an invite, and transmissions delivered live', async ({ page, browser }) => {
    const created = await (await one.api.post('/api/v1/beacons', { data: { name: `Live Smoke ${new Date().toISOString().slice(0, 16)}` } })).json();
    beaconId = created.beacon.id;
    const { relays } = await (await one.api.get(`/api/v1/beacons/${beaconId}/relays`)).json();
    textId = relays.find((r: any) => r.type === 'text').id;
    commId = relays.find((r: any) => r.type === 'comm_link').id;
    const { invite } = await (await one.api.post(`/api/v1/beacons/${beaconId}/invites`, { data: {} })).json();
    expect((await two.api.post(`/api/v1/invites/${invite.code}/accept`)).ok()).toBe(true);
    await two.api.post(`/api/v1/beacons/${beaconId}/onboarding/complete`, { data: { agreedToRules: true } });

    await signedInPage(page, one, `/channels/${beaconId}/${textId}`);
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const theirs = await other.newPage();
    await signedInPage(theirs, two, `/channels/${beaconId}/${textId}`);

    const text = `live check ${Date.now()}`;
    await page.getByRole('textbox', { name: /^Transmit to #/ }).fill(text);
    await page.getByRole('textbox', { name: /^Transmit to #/ }).press('Enter');
    await expect(theirs.getByRole('log')).toContainText(text);
    await other.close();
  });

  test('files upload to storage and come back through the edge', async () => {
    await one.api.post('/api/v1/vault/disclaimer/accept');
    const bytes = Buffer.from(`subspace live smoke ${Date.now()}`);
    const ticket = await (await one.api.post('/api/v1/vault/upload-ticket', { data: { filename: 'smoke.txt', mimeType: 'text/plain', sizeBytes: bytes.length } })).json();
    const put = await fetch(ticket.presignedUploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'text/plain' } });
    expect(put.ok, `upload: ${put.status}`).toBe(true);
    const { file } = await (await one.api.post('/api/v1/vault/files', { data: { storageKey: ticket.storageKey, filename: 'smoke.txt', mimeType: 'text/plain', sizeBytes: bytes.length } })).json();
    const back = await fetch(`${BASE}/api/v1/vault/files/${file.id}`);
    expect(Buffer.from(await back.arrayBuffer()).equals(bytes)).toBe(true);
    await one.api.delete(`/api/v1/vault/files/${file.id}`);
  });

  test('voice: two people in a Comm-Link hear each other through LiveKit', async ({ page, browser }) => {
    await signedInPage(page, one, `/channels/${beaconId}/${commId}`);
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', permissions: ['microphone', 'camera'] });
    const theirs = await other.newPage();
    await signedInPage(theirs, two, `/channels/${beaconId}/${commId}`);

    await page.getByRole('button', { name: /^Join / }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible();
    await theirs.getByRole('button', { name: /^Join / }).click();
    await expect(theirs.getByRole('main').getByRole('button', { name: 'Disconnect' })).toBeVisible();
    // The SFU reports the other person's (fake) microphone as speaking: media got through.
    await expect(theirs.getByRole('group', { name: one.user.displayName })).toHaveAttribute('data-speaking', 'true', { timeout: 40_000 });
    // The candidate type of every connected path: "relay" means through the TURN server.
    // The path each transport selected (or, without that, its nominated pair), once one is up.
    const mediaPaths = () =>
      page.evaluate(async () => {
        const types: string[] = [];
        for (const pc of (window as any).__pcs as RTCPeerConnection[]) {
          const stats = await pc.getStats();
          const selected = new Set<string>();
          stats.forEach((r: any) => r.type === 'transport' && r.selectedCandidatePairId && selected.add(r.selectedCandidatePairId));
          stats.forEach((r: any) => {
            if (r.type !== 'candidate-pair' || r.state !== 'succeeded') return;
            if (selected.size ? selected.has(r.id) : r.nominated) types.push(stats.get(r.localCandidateId)?.candidateType);
          });
        }
        return { types, states: ((window as any).__pcs as RTCPeerConnection[]).map((pc) => pc.connectionState) };
      });
    await expect.poll(async () => (await mediaPaths()).types.length, { timeout: 20_000 }).toBeGreaterThan(0);
    const { types: paths, states } = await mediaPaths();
    console.log(`media paths: ${paths.join(', ')} (connections: ${states.join(', ')})`);
    // LIVE_EXPECT_RELAY=1 on an instance with LIVEKIT_FORCE_RELAY=true.
    if (process.env.LIVE_EXPECT_RELAY) expect(paths.every((t) => t === 'relay'), `media paths: ${paths.join(', ')}`).toBe(true);
    await page.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();
    expect(cspViolations, 'Content-Security-Policy violations').toEqual([]);
    await theirs.getByRole('main').getByRole('button', { name: 'Disconnect' }).click();
    await other.close();
  });
});
