import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildFileApp } from '../../apps/file-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, driveConnections, vaultFiles, eq, and } from '@subspace/database';
import { startMockDrives, PNG, type MockDrives } from '../support/mock-drives.js';

/** Cloud drive import: OAuth with PKCE and browser binding, browsing, import rules, disconnect. */
describe('Vault: cloud drive picker', () => {
  const SECRET = getJwtSecret();
  const ORIGIN = 'http://localhost:4173';
  let app: FastifyInstance;
  let db: any;
  let mock: MockDrives;
  const alice = { id: 'd4000000-0000-4000-8000-000000000001', username: 'drive_alice' };
  const bob = { id: 'd4000000-0000-4000-8000-000000000002', username: 'drive_bob' };
  const tok = (u: typeof alice) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const inject = (method: string, url: string, user?: typeof alice, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: method as any, url, payload: payload as any, headers: { ...(user ? { authorization: `Bearer ${tok(user)}` } : {}), ...headers } });
  const saved: Record<string, string | undefined> = {};

  /** Start the flow, let the mock consent, and return the callback the popup would land on. */
  async function consent(user: typeof alice, provider: string) {
    const start = await inject('POST', `/api/v1/vault/drives/${provider}/connect`, user, {}, { origin: ORIGIN });
    expect(start.statusCode).toBe(200);
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    const res = await fetch(start.json().url, { redirect: 'manual' });
    const callback = new URL(res.headers.get('location')!);
    expect(callback.origin + callback.pathname).toBe(`${ORIGIN}/api/v1/vault/drives/${provider}/callback`);
    return { path: callback.pathname + callback.search, cookie };
  }
  async function connect(user: typeof alice, provider: string) {
    const { path, cookie } = await consent(user, provider);
    const done = await inject('GET', path, undefined, undefined, { cookie });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.body).toContain('"ok":true');
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    mock = await startMockDrives();
    for (const k of ['DRIVE_MOCK_ORIGIN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ONEDRIVE_CLIENT_ID', 'ONEDRIVE_CLIENT_SECRET', 'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'PUBLIC_ORIGIN', 'DRIVE_REDIRECT_BASE']) saved[k] = process.env[k];
    Object.assign(process.env, {
      DRIVE_MOCK_ORIGIN: mock.origin,
      GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret',
      ONEDRIVE_CLIENT_ID: 'o-id', ONEDRIVE_CLIENT_SECRET: 'o-secret',
      DROPBOX_APP_KEY: 'd-id', DROPBOX_APP_SECRET: 'd-secret',
    });
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.DRIVE_REDIRECT_BASE;
    app = await buildFileApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    for (const [u, accepted] of [[alice, true], [bob, false]] as const) {
      await db.delete(driveConnections).where(eq(driveConnections.transmitterId, u.id));
      await db.delete(vaultFiles).where(eq(vaultFiles.transmitterId, u.id));
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (existing.length) await db.update(transmitters).set({ hasAcceptedUploadDisclaimer: accepted }).where(eq(transmitters.id, u.id));
      else await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, hasAcceptedUploadDisclaimer: accepted });
    }
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    await app.close();
    await mock.close();
  });

  it('lists the drives this instance supports', async () => {
    if (!db) return;
    const res = await inject('GET', '/api/v1/vault/drives', alice);
    expect(res.json().drives).toEqual([
      { provider: 'google', name: 'Google Drive', configured: true, connected: false, accountLabel: null },
      { provider: 'onedrive', name: 'Microsoft OneDrive', configured: true, connected: false, accountLabel: null },
      { provider: 'dropbox', name: 'Dropbox', configured: true, connected: false, accountLabel: null },
    ]);
    expect((await inject('GET', '/api/v1/vault/drives')).statusCode).toBe(401);
  });

  it('only completes a sign-in in the browser that started it', async () => {
    if (!db) return;
    // No cookie: a consent link forwarded to someone else is refused.
    const stolen = await consent(alice, 'google');
    expect((await inject('GET', stolen.path)).statusCode).toBe(400);
    // Another browser's cookie does not match either.
    const other = await consent(bob, 'google');
    expect((await inject('GET', stolen.path, undefined, undefined, { cookie: other.cookie })).statusCode).toBe(400);
    // A tampered state is rejected.
    const forged = stolen.path.replace(/state=([^&]{10})/, 'state=AAAAAAAAAA');
    expect((await inject('GET', forged, undefined, undefined, { cookie: stolen.cookie })).statusCode).toBe(400);
    expect((await inject('GET', '/api/v1/vault/drives', alice)).json().drives[0].connected).toBe(false);
  });

  it('connects Google Drive, stores tokens encrypted, browses and searches', async () => {
    if (!db) return;
    await connect(alice, 'google');
    const drives = (await inject('GET', '/api/v1/vault/drives', alice)).json().drives;
    expect(drives[0]).toMatchObject({ connected: true, accountLabel: 'pilot@gmail.test' });
    const [row] = await db.select().from(driveConnections).where(and(eq(driveConnections.transmitterId, alice.id), eq(driveConnections.provider, 'google')));
    expect(row.accessToken).not.toContain('google-access');
    expect(row.refreshToken).not.toContain('google-refresh');

    const root = (await inject('GET', '/api/v1/vault/drives/google/files', alice)).json();
    expect(root.items.map((i: any) => [i.name, i.isFolder, i.importable])).toEqual([
      ['Mission Logs', true, false],
      ['nebula.png', false, true],
      ['big.bin', false, true],
      ['Briefing', false, true],
    ]);
    const folder = (await inject('GET', '/api/v1/vault/drives/google/files?folderId=fold-logs', alice)).json();
    expect(folder.items.map((i: any) => i.name)).toEqual(['log.txt']);
    const search = (await inject('GET', '/api/v1/vault/drives/google/files?q=nebula', alice)).json();
    expect(search.items.map((i: any) => i.name)).toEqual(['nebula.png']);
  });

  it('imports files into the vault under the upload rules', async () => {
    if (!db) return;
    const png = await inject('POST', '/api/v1/vault/drives/google/import', alice, { fileId: 'file-png' });
    expect(png.statusCode, png.body).toBe(201);
    expect(png.json().file).toMatchObject({ filename: 'nebula.png', mimeType: 'image/png', sizeBytes: String(PNG.length) });
    const stored = await (app as any).s3.headObject(png.json().file.storageKey);
    expect(stored.sizeBytes).toBe(PNG.length);

    const doc = await inject('POST', '/api/v1/vault/drives/google/import', alice, { fileId: 'file-doc' });
    expect(doc.json().file).toMatchObject({ filename: 'Briefing.pdf', mimeType: 'application/pdf' });

    const big = await inject('POST', '/api/v1/vault/drives/google/import', alice, { fileId: 'file-big' });
    expect(big.statusCode).toBe(400);
    expect(big.json().code).toBe('FILE_TOO_LARGE');
    const folder = await inject('POST', '/api/v1/vault/drives/google/import', alice, { fileId: 'fold-logs' });
    expect(folder.json().code).toBe('NOT_IMPORTABLE');

    const files = (await inject('GET', '/api/v1/vault/files', alice)).json().files.map((f: any) => f.filename);
    expect(files).toEqual(expect.arrayContaining(['nebula.png', 'Briefing.pdf']));
  });

  it('needs the upload disclaimer first, like any upload', async () => {
    if (!db) return;
    await connect(bob, 'google');
    const res = await inject('POST', '/api/v1/vault/drives/google/import', bob, { fileId: 'file-png' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('DISCLAIMER_REQUIRED');
  });

  it('works the same for OneDrive and Dropbox', async () => {
    if (!db) return;
    for (const [provider, folderId, label] of [['onedrive', 'fold-logs', 'pilot@outlook.test'], ['dropbox', 'id:fold-logs', 'pilot@dropbox.test']]) {
      await connect(alice, provider);
      const root = (await inject('GET', `/api/v1/vault/drives/${provider}/files`, alice)).json();
      // Folders first; Google Docs never appear outside Google Drive.
      expect(root.items[0].name).toBe('Mission Logs');
      expect(root.items.map((i: any) => i.name).sort()).toEqual(['Mission Logs', 'big.bin', 'nebula.png']);
      const folder = (await inject('GET', `/api/v1/vault/drives/${provider}/files?folderId=${encodeURIComponent(folderId)}`, alice)).json();
      const log = folder.items.find((i: any) => i.name === 'log.txt');
      const imported = await inject('POST', `/api/v1/vault/drives/${provider}/import`, alice, { fileId: log.id });
      expect(imported.statusCode, `${provider}: ${imported.body}`).toBe(201);
      expect(imported.json().file).toMatchObject({ filename: 'log.txt', mimeType: 'text/plain' });
      const drives = (await inject('GET', '/api/v1/vault/drives', alice)).json().drives;
      expect(drives.find((d: any) => d.provider === provider).accountLabel).toBe(label);
    }
  });

  it('refreshes an expired access token without asking again', async () => {
    if (!db) return;
    await db.update(driveConnections).set({ expiresAt: new Date(Date.now() - 1000) }).where(and(eq(driveConnections.transmitterId, alice.id), eq(driveConnections.provider, 'google')));
    const before = mock.log.filter((l) => l.endsWith('/token')).length;
    expect((await inject('GET', '/api/v1/vault/drives/google/files', alice)).statusCode).toBe(200);
    expect(mock.log.filter((l) => l.endsWith('/token')).length).toBe(before + 1);
  });

  it('disconnects, revoking at the provider', async () => {
    if (!db) return;
    expect((await inject('DELETE', '/api/v1/vault/drives/google', alice)).statusCode).toBe(204);
    expect(mock.log.at(-1)).toBe('POST /google/revoke');
    const res = await inject('GET', '/api/v1/vault/drives/google/files', alice);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('DRIVE_NOT_CONNECTED');
  });
});
