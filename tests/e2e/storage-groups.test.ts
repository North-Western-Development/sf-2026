import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildFileApp } from '../../apps/file-service/src/index.js';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, storageGroups, eq, or, inArray } from '@subspace/database';

/** Storage groups: admins give accounts their own Vault limits; everyone else gets the defaults. */
describe('Storage groups and the staff rank editor', () => {
  const SECRET = getJwtSecret();
  let api: FastifyInstance;
  let files: FastifyInstance;
  let db: any;
  const root = { id: '814732829158539265', username: 'sg_root', staffRank: 3 };
  const admin = { id: '814732829158539266', username: 'sg_admin', staffRank: 2 };
  const mod = { id: '814732829158539267', username: 'sg_mod', staffRank: 1 };
  const user = { id: '814732829158539268', username: 'sg_user', staffRank: 0 };
  const everyone = [root, admin, mod, user];
  const auth = (u: (typeof everyone)[number]) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: u.staffRank }, SECRET)}` });
  const call = (method: string, url: string, u: (typeof everyone)[number], payload?: unknown) => api.inject({ method: method as any, url: `/api/v1/console${url}`, headers: auth(u), payload: payload as any });
  const ticket = (sizeBytes: number) =>
    files.inject({ method: 'POST', url: '/api/v1/vault/upload-ticket', headers: auth(user), payload: { filename: 'big.bin', mimeType: 'application/octet-stream', sizeBytes } });
  const MB = 1024 * 1024;
  const names = ['Creators', 'Creators Plus'];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    api = await buildApp();
    files = await buildFileApp();
    await api.ready();
    await files.ready();
    db = (api as any).db;
    if (!db) return;
    await db.delete(storageGroups).where(inArray(storageGroups.name, names));
    await db.delete(transmitters).where(or(...everyone.map((u) => eq(transmitters.id, u.id))));
    for (const u of everyone) {
      await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, staffRank: u.staffRank, hasAcceptedUploadDisclaimer: true });
    }
  });

  afterAll(async () => {
    if (db) {
      await db.delete(transmitters).where(or(...everyone.map((u) => eq(transmitters.id, u.id))));
      await db.delete(storageGroups).where(inArray(storageGroups.name, names));
    }
    await api.close();
    await files.close();
  });

  it('applies a group quota and upload limit to its members, and the defaults to everyone else', async () => {
    if (!db) return;
    expect((await call('GET', '/storage-groups', mod)).json().code).toBe('INSUFFICIENT_STAFF_RANK');
    const listed = (await call('GET', '/storage-groups', admin)).json();
    expect(listed.defaults).toEqual({ quotaMb: 500, maxUploadMb: 50 });

    // Outside a group: 50 MB per upload.
    expect((await ticket(60 * MB)).json().code).toBe('FILE_TOO_LARGE');
    const group = (await call('POST', '/storage-groups', admin, { name: 'Creators', quotaMb: 2048, maxUploadMb: 500 })).json().group;
    expect(group).toMatchObject({ name: 'Creators', quotaMb: 2048, maxUploadMb: 500 });
    expect((await call('POST', '/storage-groups', admin, { name: 'Creators', quotaMb: 1, maxUploadMb: 1 })).json().code).toBe('GROUP_NAME_TAKEN');

    expect((await call('PATCH', `/transmitters/${user.id}/storage-group`, admin, { groupId: group.id })).json().transmitter.storageGroupId).toBe(group.id);
    const ok = (await ticket(60 * MB)).json();
    expect(ok.storageKey).toBeTruthy();
    // The declared size is signed into the upload URL, so a bigger body is refused by storage.
    expect(decodeURIComponent(ok.presignedUploadUrl)).toContain('content-length');
    expect((await ticket(600 * MB)).json().code).toBe('FILE_TOO_LARGE');
    const quota = (await files.inject({ method: 'GET', url: '/api/v1/vault/quota', headers: auth(user) })).json();
    expect(quota).toMatchObject({ quotaBytes: 2048 * MB, maxUploadBytes: 500 * MB, storageGroup: 'Creators' });

    // Editing the group changes its members' limits; deleting it puts them back on the defaults.
    await call('PATCH', `/storage-groups/${group.id}`, admin, { name: 'Creators Plus', quotaMb: 100 });
    expect((await ticket(200 * MB)).json().code).toBe('STORAGE_QUOTA_EXCEEDED');
    expect((await call('GET', '/storage-groups', admin)).json().groups.find((g: any) => g.id === group.id)).toMatchObject({ name: 'Creators Plus', members: 1 });
    await call('DELETE', `/storage-groups/${group.id}`, admin);
    expect((await files.inject({ method: 'GET', url: '/api/v1/vault/quota', headers: auth(user) })).json()).toMatchObject({ quotaBytes: 500 * MB, storageGroup: null });
  });

  it('lets only root change staff ranks, and never its own', async () => {
    if (!db) return;
    expect((await call('PATCH', `/transmitters/${user.id}/staff-rank`, admin, { staffRank: 1 })).json().code).toBe('INSUFFICIENT_STAFF_RANK');
    expect((await call('PATCH', `/transmitters/${user.id}/staff-rank`, root, { staffRank: 1 })).json().transmitter.staffRank).toBe(1);
    expect((await call('PATCH', `/transmitters/${root.id}/staff-rank`, root, { staffRank: 0 })).json().code).toBe('SELF_DEMOTION');
    await call('PATCH', `/transmitters/${user.id}/staff-rank`, root, { staffRank: 0 });
  });
});
