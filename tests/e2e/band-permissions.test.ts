import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, beacons, eq, or } from '@subspace/database';

/** Frequency Band (category) permissions, and relays synced to them (Discord's sync rules). */
describe('Band permissions and sync', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const owner = { id: '840684594228625409', username: 'band_owner' };
  const member = { id: '840684594228625410', username: 'band_member' };
  const users = [owner, member];
  const auth = (u: typeof owner) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: typeof owner, payload?: unknown) => app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  const visible = async () => (await call('GET', `/beacons/${beaconId}/relays`, member)).json().relays.map((r: any) => r.name);
  const VIEW = PERMISSIONS.VIEW_RELAY.toString();
  let beaconId = '';
  let everyone = '';
  let band = '';
  let inside = '';
  let outside = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    for (const u of users) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username, isEmailVerified: true });
    beaconId = (await call('POST', '/beacons', owner, { name: 'Bands', isDiscoverable: true })).json().beacon.id;
    everyone = (await call('GET', `/beacons/${beaconId}/clearances`, owner)).json().clearances.find((c: any) => c.position === 0).id;
    band = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'Staff', type: 'category' })).json().relay.id;
    inside = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'inside', type: 'text', parentId: band })).json().relay.id;
    outside = (await call('POST', `/beacons/${beaconId}/relays`, owner, { name: 'outside', type: 'text' })).json().relay.id;
    await call('POST', `/beacons/${beaconId}/join`, member);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(beacons).where(eq(beacons.ownerId, owner.id));
      await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    }
    await app.close();
  });

  it('a band hides its synced relays, and a relay-level change un-syncs that relay instead of being ignored', async () => {
    if (!db) return;
    expect(await visible()).toEqual(expect.arrayContaining(['inside', 'outside']));
    await call('PUT', `/beacons/${beaconId}/relays/${band}/overwrites/${everyone}`, owner, { targetType: 'clearance', allow: '0', deny: VIEW });
    expect(await visible()).not.toContain('inside');
    // A synced relay shows the band's overwrites, the ones in effect.
    const synced = (await call('GET', `/beacons/${beaconId}/relays/${inside}/overwrites`, owner)).json();
    expect(synced).toMatchObject({ synced: true, parentId: band, overwrites: [{ targetId: everyone, deny: VIEW }] });

    // Let one member in on this relay only: it takes a copy of the band's and stops following it.
    await call('PUT', `/beacons/${beaconId}/relays/${inside}/overwrites/${member.id}`, owner, { targetType: 'transmitter', allow: VIEW, deny: '0' });
    expect(await visible()).toContain('inside');
    const own = (await call('GET', `/beacons/${beaconId}/relays/${inside}/overwrites`, owner)).json();
    expect(own.synced).toBe(false);
    expect(own.overwrites.map((o: any) => o.targetId).sort()).toEqual([everyone, member.id].sort());

    // Band changes no longer reach it...
    await call('DELETE', `/beacons/${beaconId}/relays/${band}/overwrites/${everyone}`, owner);
    expect((await call('GET', `/beacons/${beaconId}/relays/${inside}/overwrites`, owner)).json().overwrites).toHaveLength(2);
    // ...until it syncs again, dropping its own.
    await call('PUT', `/beacons/${beaconId}/relays/${band}/overwrites/${everyone}`, owner, { targetType: 'clearance', allow: '0', deny: VIEW });
    expect((await call('POST', `/beacons/${beaconId}/relays/${inside}/overwrites/sync`, owner)).json()).toEqual({ synced: true });
    expect(await visible()).not.toContain('inside');
    expect((await call('POST', `/beacons/${beaconId}/relays/${outside}/overwrites/sync`, owner)).json().code).toBe('NO_BAND');
  });

  it('moving a relay into a band syncs it on request, and only into a band of the same beacon', async () => {
    if (!db) return;
    expect((await call('PATCH', `/beacons/${beaconId}/relays/${outside}`, owner, { parentId: inside })).json().code).toBe('INVALID_PARENT');
    await call('PUT', `/beacons/${beaconId}/relays/${outside}/overwrites/${member.id}`, owner, { targetType: 'transmitter', allow: VIEW, deny: '0' });
    await call('PATCH', `/beacons/${beaconId}/relays/${outside}`, owner, { parentId: band, permissionsSynced: true });
    // Its own overwrites went with the sync; the band's deny now applies.
    expect(await visible()).not.toContain('outside');
    expect((await call('GET', `/beacons/${beaconId}/relays/${outside}/overwrites`, owner)).json()).toMatchObject({ synced: true, overwrites: [{ targetId: everyone }] });
  });
});
