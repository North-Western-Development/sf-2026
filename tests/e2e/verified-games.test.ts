import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, oauthApps, staffAuditLog, inArray } from '@subspace/database';

/** Command Console › Verified Games: a game's own application replaces its Steam cover. */
describe('Verified games', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const root = { id: '801756946623499001', username: 'vg_root' };
  const admin = { id: '801756946623499002', username: 'vg_admin' };
  const dev = { id: '801756946623499003', username: 'vg_dev' };
  const ids = [root.id, admin.id, dev.id];
  const official = '801756946623499101';
  const impostor = '801756946623499102';
  const call = (u: { id: string; username: string } | null, method: string, url: string, payload?: unknown) =>
    app.inject({
      method: method as any,
      url: `/api/v1${url}`,
      headers: u ? { authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` } : {},
      payload: payload as any,
    });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(transmitters).where(inArray(transmitters.id, ids));
    const base = { passwordHash: 'x', isEmailVerified: true };
    await db.insert(transmitters).values([
      { ...base, id: root.id, username: root.username, email: 'vg_root@subspace.test', displayName: 'Root', staffRank: 3 },
      { ...base, id: admin.id, username: admin.username, email: 'vg_admin@subspace.test', displayName: 'Admin', staffRank: 2 },
      { ...base, id: dev.id, username: dev.username, email: 'vg_dev@subspace.test', displayName: 'Dev' },
    ]);
    await db.insert(oauthApps).values([
      { id: official, ownerId: dev.id, name: 'Valheim Official', iconUrl: '/subspace-media/app-icon/valheim.png', clientSecretHash: 'x' },
      { id: impostor, ownerId: dev.id, name: 'Another App', iconUrl: null, clientSecretHash: 'x' },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(staffAuditLog).where(inArray(staffAuditLog.actorId, ids));
      await db.delete(transmitters).where(inArray(transmitters.id, ids));
    }
    await app.close();
  });

  it('only staff with Manage developers can link, and only to a detected game', async () => {
    if (!db) return;
    expect((await call(dev, 'GET', '/console/verified-games')).statusCode).toBe(403);
    // The built-in Admin rank does not have it until Root gives it.
    expect((await call(admin, 'PUT', '/console/verified-games', { game: 'Valheim', applicationId: official })).json().code).toBe('INSUFFICIENT_STAFF_RANK');
    expect((await call(root, 'PUT', '/console/verified-games', { game: 'Made Up Game', applicationId: official })).json().code).toBe('UNKNOWN_GAME');
    expect((await call(root, 'PUT', '/console/verified-games', { game: 'Valheim', applicationId: '801756946623499999' })).statusCode).toBe(404);

    const ok = await call(root, 'PUT', '/console/verified-games', { game: 'Valheim', applicationId: official });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().games).toContainEqual({ game: 'Valheim', application: { id: official, name: 'Valheim Official', iconUrl: '/subspace-media/app-icon/valheim.png', owner: dev.username } });

    // Anyone signed in (the sharer's client) can read the list.
    const pub = (await call(dev, 'GET', '/oauth2/verified-games')).json();
    expect(pub.games.Valheim).toEqual({ applicationId: official, name: 'Valheim Official', iconUrl: '/subspace-media/app-icon/valheim.png' });

    const log = (await call(root, 'GET', '/console/audit-log')).json();
    expect(log.entries[0]).toMatchObject({ action: 'game.verify', summary: 'Verified Valheim Official as Valheim' });
  });

  it('one application per game and one game per application', async () => {
    if (!db) return;
    await call(root, 'PUT', '/console/verified-games', { game: 'Valheim', applicationId: impostor });
    let pub = (await call(dev, 'GET', '/oauth2/verified-games')).json();
    expect(pub.games.Valheim.applicationId).toBe(impostor);
    // Moving it to another game frees the first.
    await call(root, 'PUT', '/console/verified-games', { game: 'Terraria', applicationId: impostor });
    pub = (await call(dev, 'GET', '/oauth2/verified-games')).json();
    expect(pub.games.Valheim).toBeUndefined();
    expect(pub.games.Terraria.applicationId).toBe(impostor);

    expect((await call(root, 'DELETE', '/console/verified-games?game=Terraria')).statusCode).toBe(204);
    expect((await call(root, 'DELETE', '/console/verified-games?game=Terraria')).statusCode).toBe(404);
    pub = (await call(dev, 'GET', '/oauth2/verified-games')).json();
    expect(pub.games).not.toHaveProperty('Terraria');
  });
});
