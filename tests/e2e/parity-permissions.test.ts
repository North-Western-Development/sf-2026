import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, eq } from '@subspace/database';
import { Redis } from 'ioredis';

describe('Parity Section 1: Relay Permission Overwrites E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const ownerId = 'a0000000-0000-0000-0000-000000000001';
  const memberId = 'a0000000-0000-0000-0000-000000000002';
  const outsiderId = 'a0000000-0000-0000-0000-000000000003';

  let ownerToken: string;
  let memberToken: string;
  let outsiderToken: string;

  let beaconId: string;
  let textRelayId: string;
  let categoryId: string;
  let syncedRelayId: string;
  let modClearanceId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    const db = (app as any).db;
    if (db) {
      const users = [
        { id: ownerId, username: 'perm_owner', email: 'perm_owner@subspace.net', passwordHash: 'hash', displayName: 'Perm Owner' },
        { id: memberId, username: 'perm_member', email: 'perm_member@subspace.net', passwordHash: 'hash', displayName: 'Perm Member' },
        { id: outsiderId, username: 'perm_outsider', email: 'perm_outsider@subspace.net', passwordHash: 'hash', displayName: 'Perm Outsider' },
      ];
      for (const u of users) {
        const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
        if (existing.length === 0) await db.insert(transmitters).values(u);
      }
    }

    ownerToken = signAccessToken({ transmitterId: ownerId, username: 'perm_owner', staffRank: 0 }, JWT_SECRET);
    memberToken = signAccessToken({ transmitterId: memberId, username: 'perm_member', staffRank: 0 }, JWT_SECRET);
    outsiderToken = signAccessToken({ transmitterId: outsiderId, username: 'perm_outsider', staffRank: 0 }, JWT_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  async function captureBus(action: () => Promise<unknown>): Promise<any[]> {
    const sub = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
    const events: any[] = [];
    try {
      await sub.connect();
    } catch {
      return events;
    }
    await sub.subscribe('gateway:transmission:events');
    sub.on('message', (_c, m) => events.push(JSON.parse(m)));
    await action();
    await new Promise((r) => setTimeout(r, 150));
    await sub.quit();
    return events;
  }

  it('provisions a beacon, category, synced relay, and member clearance', async () => {
    if (!(app as any).db) return;
    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Overwrite Test Beacon', isDiscoverable: true },
    });
    expect(bRes.statusCode).toBe(201);
    beaconId = bRes.json().beacon.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/join`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    const catRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'category-band', type: 'text' },
    });
    categoryId = catRes.json().relay.id;

    const relayRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'general', type: 'text' },
    });
    expect(relayRes.statusCode).toBe(201);
    textRelayId = relayRes.json().relay.id;

    const syncedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'synced-child', type: 'text', parentId: categoryId, permissionsSynced: true },
    });
    syncedRelayId = syncedRes.json().relay.id;

    const clearRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/clearances`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Moderator', position: 5, permissions: PERMISSIONS.MANAGE_CLEARANCES.toString() },
    });
    modClearanceId = clearRes.json().clearance.id;
  });

  it('401s without a token and 403s for an outsider on overwrite routes', async () => {
    if (!(app as any).db) return;
    const noAuth = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/relays/${textRelayId}/overwrites`,
    });
    expect(noAuth.statusCode).toBe(401);

    const outsider = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/relays/${textRelayId}/overwrites`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(outsider.statusCode).toBe(403);
  });

  it('exposes myPermissions in the relay list for gating client UI', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(200);
    const relay = res.json().relays.find((r: any) => r.id === textRelayId);
    expect(relay.myPermissions).toBeDefined();
    expect(BigInt(relay.myPermissions) & PERMISSIONS.VIEW_RELAY).toBe(PERMISSIONS.VIEW_RELAY);
  });

  it('applies the @everyone deny overwrite and removes the member from the relay audience', async () => {
    if (!(app as any).db) return;
    const denyAll = PERMISSIONS.VIEW_RELAY.toString();

    // Find the @everyone clearance id
    const clearancesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/clearances`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const everyoneClearance = clearancesRes.json().clearances.find((c: any) => c.position === 0);

    const events = await captureBus(async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/beacons/${beaconId}/relays/${textRelayId}/overwrites/${everyoneClearance.id}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { targetType: 'clearance', deny: denyAll },
      });
      expect(res.statusCode).toBe(200);
    });

    if ((app as any).redis) {
      const updateEvent = events.find((e) => e.type === 'RELAY_UPDATE');
      expect(updateEvent).toBeDefined();
      // Audience = members who could see the relay before OR after the change, so the
      // member (who just lost access) is still notified once so their client can react.
      expect(updateEvent.audience).toContain(ownerId);
      expect(updateEvent.audience).toContain(memberId);
    }

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const relay = listRes.json().relays.find((r: any) => r.id === textRelayId);
    expect(BigInt(relay.myPermissions) & PERMISSIONS.VIEW_RELAY).toBe(0n);

    // Cleanup: restore visibility for later assertions
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/beacons/${beaconId}/relays/${textRelayId}/overwrites/${everyoneClearance.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
  });

  it('an allow overwrite on a member overrides a role deny', async () => {
    if (!(app as any).db) return;
    // Assign moderator clearance to member, then deny SEND_TRANSMISSIONS at the role level
    await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/clearances/members/${memberId}/assign`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { clearanceId: modClearanceId, action: 'add' },
    });

    await app.inject({
      method: 'PUT',
      url: `/api/v1/beacons/${beaconId}/relays/${textRelayId}/overwrites/${modClearanceId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { targetType: 'clearance', deny: PERMISSIONS.SEND_TRANSMISSIONS.toString() },
    });

    let perms = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    let relay = perms.json().relays.find((r: any) => r.id === textRelayId);
    expect(BigInt(relay.myPermissions) & PERMISSIONS.SEND_TRANSMISSIONS).toBe(0n);

    // Member-specific allow overrides the role-level deny
    await app.inject({
      method: 'PUT',
      url: `/api/v1/beacons/${beaconId}/relays/${textRelayId}/overwrites/${memberId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { targetType: 'transmitter', allow: PERMISSIONS.SEND_TRANSMISSIONS.toString() },
    });

    perms = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    relay = perms.json().relays.find((r: any) => r.id === textRelayId);
    expect(BigInt(relay.myPermissions) & PERMISSIONS.SEND_TRANSMISSIONS).toBe(PERMISSIONS.SEND_TRANSMISSIONS);
  });

  it('a synced relay inherits its parent category overwrites instead of its own', async () => {
    if (!(app as any).db) return;
    const clearancesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/clearances`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const everyoneClearance = clearancesRes.json().clearances.find((c: any) => c.position === 0);

    // Deny VIEW_RELAY on the category (parent); the synced child should inherit it.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/beacons/${beaconId}/relays/${categoryId}/overwrites/${everyoneClearance.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { targetType: 'clearance', deny: PERMISSIONS.VIEW_RELAY.toString() },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const synced = res.json().relays.find((r: any) => r.id === syncedRelayId);
    expect(BigInt(synced.myPermissions) & PERMISSIONS.VIEW_RELAY).toBe(0n);
  });

  it('enforces hierarchy: cannot grant/deny a permission bit you do not hold yourself', async () => {
    if (!(app as any).db) return;
    // Member (has MANAGE_CLEARANCES only, from beacon-level bits) tries to grant BAN_MEMBERS
    // via an overwrite despite not holding it themselves.
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/beacons/${beaconId}/relays/${textRelayId}/overwrites/${outsiderId}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { targetType: 'transmitter', allow: PERMISSIONS.BAN_MEMBERS.toString() },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN_HIERARCHY');
  });

  it('validates the overwrite body (400 for garbage bitfields)', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/beacons/${beaconId}/relays/${textRelayId}/overwrites/${memberId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { targetType: 'transmitter', allow: 'not-a-number' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s overwrite routes for an unknown relay', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/beacons/${beaconId}/relays/00000000-0000-0000-0000-000000000000/overwrites`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
