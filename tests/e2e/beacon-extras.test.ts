import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, eq, or } from '@subspace/database';

/** Templates, Insights, the Widget and Beacon Tags. */
describe('Beacon extras', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: 'fc000000-0000-4000-8000-000000000001', username: 'ext_owner' };
  const guest = { id: 'fc000000-0000-4000-8000-000000000002', username: 'ext_guest' };
  const auth = (u: { id: string; username: string }) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: { id: string; username: string } | null, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: u ? auth(u) : {}, payload: payload as any });
  let beaconId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(or(eq(beacons.ownerId, owner.id), eq(beacons.ownerId, guest.id)));
    await db.delete(transmitters).where(or(eq(transmitters.id, owner.id), eq(transmitters.id, guest.id)));
    for (const u of [owner, guest]) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true });
    beaconId = (await call('POST', '/beacons', owner, { name: 'Extras Beacon', isDiscoverable: true })).json().beacon.id;
    await call('POST', `/beacons/${beaconId}/join`, guest);
  });

  afterAll(async () => {
    if (db) await db.delete(beacons).where(or(eq(beacons.ownerId, owner.id), eq(beacons.ownerId, guest.id)));
    await app.close();
  });

  it('starts beacons from built-in templates', async () => {
    if (!db) return;
    expect((await call('POST', '/beacons', guest, { name: 'Bad', template: 'nope' })).statusCode).toBe(400);
    const b = (await call('POST', '/beacons', guest, { name: 'Study Hall', template: 'study-group' })).json().beacon;
    const relays = (await call('GET', `/beacons/${b.id}/relays`, guest)).json().relays;
    expect(relays.map((r: any) => r.name)).toEqual(expect.arrayContaining(['homework-help', 'Study Room 2', 'Welcome']));
    const homework = relays.find((r: any) => r.name === 'homework-help');
    expect(relays.find((r: any) => r.id === homework.parentId).name).toBe('Text Relays');
    expect(b.systemChannelId).toBe(relays.find((r: any) => r.name === 'welcome-and-rules').id);
  });

  it('saves, syncs and shares a template that new beacons copy', async () => {
    if (!db) return;
    await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'lore', type: 'text' });
    await call('POST', `/beacons/${beaconId}/clearances`, owner, { name: 'Captain', position: 1, permissions: '0', color: '#ff0000' });
    expect((await call('POST', `/beacons/${beaconId}/template`, guest, { name: 'x' })).statusCode).toBe(403);
    const t = (await call('POST', `/beacons/${beaconId}/template`, owner, { name: 'Crew Layout', description: 'For crews' })).json().template;
    expect((await call('POST', `/beacons/${beaconId}/template`, owner, { name: 'again' })).statusCode).toBe(409);

    await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'added-later', type: 'text' });
    const preview = (await call('GET', `/templates/${t.code}`, guest)).json().template;
    expect(preview.snapshot.relays.map((r: any) => r.name)).not.toContain('added-later');
    expect(preview.beaconId).toBeUndefined();
    await call('PUT', `/beacons/${beaconId}/template/sync`, owner);
    expect((await call('GET', `/templates/${t.code}`, guest)).json().template.snapshot.relays.map((r: any) => r.name)).toContain('added-later');

    const copy = (await call('POST', '/beacons', guest, { name: 'My Crew', templateCode: t.code })).json().beacon;
    const names = (await call('GET', `/beacons/${copy.id}/relays`, guest)).json().relays.map((r: any) => r.name);
    expect(names).toEqual(expect.arrayContaining(['lore', 'added-later', 'general']));
    const roles = (await call('GET', `/beacons/${copy.id}/clearances`, guest)).json().clearances;
    expect(roles.map((c: any) => c.name)).toContain('Captain');
    expect((await call('GET', `/templates/${t.code}`, guest)).json().template.usageCount).toBe(1);
    await call('DELETE', `/beacons/${beaconId}/template`, owner);
    expect((await call('GET', `/templates/${t.code}`, guest)).statusCode).toBe(404);
  });

  it('reports insights to managers', async () => {
    if (!db) return;
    const relays = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays;
    await call('POST', `/channels/relay/${relays.find((r: any) => r.name === 'general').id}/transmissions`, owner, { content: 'counted' });
    expect((await call('GET', `/beacons/${beaconId}/insights`, guest)).statusCode).toBe(403);
    const data = (await call('GET', `/beacons/${beaconId}/insights?days=7`, owner)).json();
    expect(data.series).toHaveLength(7);
    expect(data.totals.members).toBe(2);
    expect(data.totals.messages).toBeGreaterThanOrEqual(1);
    expect(data.joinMethods).toMatchObject({ owner: 1, discovery: 1 });
    expect(data.topRelays[0].name).toBe('general');
  });

  it('serves the widget only when it is on, signed out, with a lasting invite', async () => {
    if (!db) return;
    expect((await call('GET', `/beacons/${beaconId}/widget.json`, null)).statusCode).toBe(403);
    const relays = (await call('GET', `/beacons/${beaconId}/relays`, owner)).json().relays;
    await call('PATCH', `/beacons/${beaconId}`, owner, { widgetEnabled: true, widgetChannelId: relays.find((r: any) => r.name === 'general').id });
    const w = (await call('GET', `/beacons/${beaconId}/widget.json`, null)).json();
    expect(w).toMatchObject({ id: beaconId, name: 'Extras Beacon', memberCount: 2 });
    expect(w.instantInvite).toBeTruthy();
    expect((await call('GET', `/beacons/${beaconId}/widget.json`, null)).json().instantInvite).toBe(w.instantInvite);
  });

  it('lets members wear a beacon tag', async () => {
    if (!db) return;
    expect((await call('PATCH', `/beacons/${beaconId}`, owner, { tag: 'toolong' })).statusCode).toBe(400);
    expect((await call('PUT', '/users/@me/tag', guest, { beaconId })).statusCode).toBe(400);
    await call('PATCH', `/beacons/${beaconId}`, owner, { tag: 'crw', tagBadge: '🚀' });
    expect((await call('PUT', '/users/@me/tag', guest, { beaconId })).statusCode).toBe(200);
    const tags = (await call('GET', `/beacon-tags?ids=${beaconId}`, owner)).json().tags;
    expect(tags).toEqual([{ id: beaconId, name: 'Extras Beacon', tag: 'CRW', tagBadge: '🚀' }]);
    const profile = (await call('GET', `/users/${guest.id}/profile`, owner)).json();
    expect(profile.user.tagBeaconId).toBe(beaconId);
    const stranger = { id: 'fc000000-0000-4000-8000-000000000009', username: 'ext_stranger' };
    await db.delete(transmitters).where(eq(transmitters.id, stranger.id));
    await db.insert(transmitters).values({ id: stranger.id, username: stranger.username, email: 'ext_stranger@subspace.test', passwordHash: 'x', displayName: 's' });
    expect((await call('PUT', '/users/@me/tag', stranger, { beaconId })).statusCode).toBe(403);
    await db.delete(transmitters).where(eq(transmitters.id, stranger.id));
  });
});
