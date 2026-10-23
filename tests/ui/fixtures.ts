import { test as base, expect, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';

export const BASE_URL = 'http://localhost:4173';
export const PASSWORD = 'ui-test-password-1';

export interface Transmitter {
  id: string;
  username: string;
  discriminator: string;
  displayName: string;
  email: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  transmitter: Transmitter;
  /** Authenticated API client for arranging state without the UI. */
  api: Api;
}

let counter = 0;
/** Usernames unique across workers and runs: 2-32 chars of [a-z0-9_.]. */
export const uniqueName = (prefix: string) =>
  `${prefix}_${process.pid.toString(36)}${(Date.now() % 1e6).toString(36)}${(counter++).toString(36)}`.slice(0, 32);

export class Api {
  constructor(private ctx: APIRequestContext, private token: string) {}

  private async call<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown): Promise<T> {
    const res = await this.ctx.fetch(`/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}` },
      ...(data !== undefined ? { data } : {}),
    });
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${await res.text()}`);
    return (res.status() === 204 ? undefined : await res.json()) as T;
  }

  get = <T = any>(path: string) => this.call<T>('GET', path);
  post = <T = any>(path: string, data: unknown = {}) => this.call<T>('POST', path, data);
  patch = <T = any>(path: string, data: unknown) => this.call<T>('PATCH', path, data);
  delete = <T = any>(path: string) => this.call<T>('DELETE', path);

  async createBeacon(name = 'Test Beacon') {
    const { beacon } = await this.post('/beacons', { name });
    const { relays } = await this.get(`/beacons/${beacon.id}/relays`);
    return { beacon, relays: relays as Array<{ id: string; name: string; type: string }> };
  }
  async createRelay(beaconId: string, name: string, type = 'text') {
    return (await this.post(`/beacons/${beaconId}/relays`, { name, type })).relay as { id: string; name: string };
  }
  async createInvite(beaconId: string) {
    return (await this.post(`/beacons/${beaconId}/invites`, {})).invite as { code: string };
  }
  async acceptInvite(code: string) {
    return this.post(`/invites/${code}/accept`);
  }
  /** Join through an invite and pass the rules gate, like a member who has been around a while. */
  async join(beaconId: string, code: string) {
    await this.acceptInvite(code);
    await this.post(`/beacons/${beaconId}/onboarding/complete`, { agreedToRules: true });
  }
  async send(relayId: string, content: string) {
    return (await this.post(`/channels/relay/${relayId}/transmissions`, { content })).transmission as { id: string };
  }
  async befriend(other: Session) {
    const { affiliation } = await this.post('/affiliations/request', { targetId: other.transmitter.id });
    await other.api.post(`/affiliations/${affiliation.id}/accept`);
  }
  async openDm(other: Session, content: string) {
    return this.post(`/links/${other.transmitter.id}/transmissions`, { content });
  }
}

export async function register(prefix = 'pilot', displayName?: string): Promise<Session> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const username = uniqueName(prefix);
  const res = await ctx.post('/api/v1/auth/register', {
    data: { username, email: `${username}@ui-test.subspace`, password: PASSWORD, displayName: displayName ?? username, acceptDirectives: true },
  });
  if (!res.ok()) throw new Error(`register ${username} -> ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, transmitter: { ...body.transmitter, email: `${username}@ui-test.subspace` }, api: new Api(ctx, body.accessToken) };
}

/** Put the session in localStorage before the app boots, exactly as a real sign-in leaves it. */
export async function signIn(page: Page, session: Session, path = '/channels/@me', { shell = !path.startsWith('/invite/') } = {}) {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('ui-test-signed-in')) return;
    sessionStorage.setItem('ui-test-signed-in', '1');
    localStorage.setItem('subspace_access_token', s.accessToken);
    localStorage.setItem('subspace_refresh_token', s.refreshToken);
    localStorage.setItem('subspace_user', JSON.stringify(s.transmitter));
  }, { accessToken: session.accessToken, refreshToken: session.refreshToken, transmitter: session.transmitter });
  await page.goto(path);
  if (shell) await expect(page.getByRole('navigation', { name: 'Beacons' })).toBeVisible();
  else await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

/** A second browser context for multi-user scenarios (separate storage, like another device). */
export async function openAs(browser: Browser, session: Session, path?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage();
  await signIn(page, session, path);
  return page;
}

type Fixtures = { me: Session; consoleErrors: string[] };

export const test = base.extend<Fixtures>({
  me: async ({}, use) => {
    await use(await register('me'));
  },
  // Fails any test whose page logs an uncaught error or a React warning.
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR/.test(m.text())) errors.push(m.text());
      });
      await use(errors);
      expect(errors, 'browser console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
