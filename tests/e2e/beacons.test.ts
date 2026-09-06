import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, eq } from '@subspace/database';

describe('Beacons, Beacon Clusters & Clearances E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  // Test Transmitters
  const ownerId = '11111111-1111-1111-1111-111111111111';
  const officerId = '22222222-2222-2222-2222-222222222222';
  const cadetId = '33333333-3333-3333-3333-333333333333';

  let ownerToken: string;
  let officerToken: string;
  let cadetToken: string;

  let createdBeaconId: string;
  let everyoneRoleId: string;
  let officerRoleId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    // Ensure database seed for test transmitters
    const db = (app as any).db;
    if (db) {
      const usersToSeed = [
        { id: ownerId, username: 'admiral_kirk', email: 'kirk@starfleet.net', passwordHash: 'hash', displayName: 'Admiral Kirk' },
        { id: officerId, username: 'commander_spock', email: 'spock@starfleet.net', passwordHash: 'hash', displayName: 'Commander Spock' },
        { id: cadetId, username: 'cadet_scotty', email: 'scotty@starfleet.net', passwordHash: 'hash', displayName: 'Cadet Scotty' },
      ];
      for (const u of usersToSeed) {
        const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
        if (existing.length === 0) {
          await db.insert(transmitters).values(u);
        }
      }
    }

    ownerToken = signAccessToken(
      { transmitterId: ownerId, username: 'admiral_kirk', staffRank: 0 },
      JWT_SECRET
    );
    officerToken = signAccessToken(
      { transmitterId: officerId, username: 'commander_spock', staffRank: 0 },
      JWT_SECRET
    );
    cadetToken = signAccessToken(
      { transmitterId: cadetId, username: 'cadet_scotty', staffRank: 0 },
      JWT_SECRET
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a new Beacon with auto-generated @everyone role at position 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'Starbase 12',
        description: 'Deep space outpost',
        isDiscoverable: true,
        suppressCustomFonts: true,
        rulesText: 'Rule 1: Maintain subspace frequency discipline.',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.beacon.name).toBe('Starbase 12');
    expect(body.beacon.ownerId).toBe(ownerId);
    expect(body.everyoneClearance.name).toBe('@everyone');
    expect(body.everyoneClearance.position).toBe(0);

    createdBeaconId = body.beacon.id;
    everyoneRoleId = body.everyoneClearance.id;
  });

  it('confirms that permissions on @everyone CAN be modified', async () => {
    const updatedBits = (PERMISSIONS.VIEW_RELAY | PERMISSIONS.SEND_TRANSMISSIONS).toString();
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${createdBeaconId}/clearances/${everyoneRoleId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { permissions: updatedBits },
    });
    expect(updateRes.statusCode).toBe(200);
    const body = JSON.parse(updateRes.payload);
    expect(body.clearance.permissions).toBe(updatedBits);
  });

  it('confirms that @everyone CANNOT be deleted', async () => {
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/beacons/${createdBeaconId}/clearances/${everyoneRoleId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(delRes.statusCode).toBe(400);
    expect(JSON.parse(delRes.payload).code).toBe('CANNOT_DELETE_BASE_CLEARANCE');
  });

  it('confirms that @everyone CANNOT be moved above any other roles (position cannot change from 0)', async () => {
    // Attempt moving @everyone to position 1
    const moveRes1 = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${createdBeaconId}/clearances/${everyoneRoleId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { position: 1 },
    });
    expect(moveRes1.statusCode).toBe(400);
    expect(JSON.parse(moveRes1.payload).code).toBe('CANNOT_REORDER_BASE_CLEARANCE');

    // Attempt moving @everyone to position 50
    const moveRes50 = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${createdBeaconId}/clearances/${everyoneRoleId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { position: 50 },
    });
    expect(moveRes50.statusCode).toBe(400);
    expect(JSON.parse(moveRes50.payload).code).toBe('CANNOT_REORDER_BASE_CLEARANCE');
  });

  it('confirms that NO other roles can be created or moved below or at @everyone (position <= 0)', async () => {
    // 1. Attempt creating a role at position 0 (at @everyone level) -> rejected
    const createPos0 = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/clearances`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'Below Everyone Role',
        position: 0,
      },
    });
    expect(createPos0.statusCode).toBe(400);
    expect(JSON.parse(createPos0.payload).code).toBe('CANNOT_PLACE_BELOW_BASE_CLEARANCE');

    // 2. Attempt creating a role at position -1 (below @everyone) -> rejected
    const createNegative = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/clearances`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'Sub-Zero Role',
        position: -1,
      },
    });
    expect(createNegative.statusCode).toBe(400);
    expect(JSON.parse(createNegative.payload).code).toBe('CANNOT_PLACE_BELOW_BASE_CLEARANCE');

    // 3. Create a valid role at position 10
    const officerBits = (
      PERMISSIONS.VIEW_RELAY |
      PERMISSIONS.SEND_TRANSMISSIONS |
      PERMISSIONS.MANAGE_CLEARANCES |
      PERMISSIONS.KICK_MEMBERS
    ).toString();

    const createValid = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/clearances`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'Command Officer',
        color: '#FF0055',
        position: 10,
        permissions: officerBits,
        allowDelegation: false,
      },
    });
    expect(createValid.statusCode).toBe(201);
    const body = JSON.parse(createValid.payload);
    expect(body.clearance.name).toBe('Command Officer');
    expect(body.clearance.position).toBe(10);
    officerRoleId = body.clearance.id;

    // 4. Attempt moving the valid role to position 0 (down to @everyone level) -> rejected
    const moveDownTo0 = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${createdBeaconId}/clearances/${officerRoleId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { position: 0 },
    });
    expect(moveDownTo0.statusCode).toBe(400);
    expect(JSON.parse(moveDownTo0.payload).code).toBe('CANNOT_PLACE_BELOW_BASE_CLEARANCE');

    // 5. Attempt moving the valid role to position -5 (below @everyone) -> rejected
    const moveDownNegative = await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${createdBeaconId}/clearances/${officerRoleId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { position: -5 },
    });
    expect(moveDownNegative.statusCode).toBe(400);
    expect(JSON.parse(moveDownNegative.payload).code).toBe('CANNOT_PLACE_BELOW_BASE_CLEARANCE');
  });

  it('handles member joining and onboarding state machine', async () => {
    // Officer joins beacon
    const joinRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/join`,
      headers: { authorization: `Bearer ${officerToken}` },
    });
    expect(joinRes.statusCode).toBe(201);
    expect(JSON.parse(joinRes.payload).requiresOnboarding).toBe(true);

    // Cadet joins beacon
    await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/join`,
      headers: { authorization: `Bearer ${cadetToken}` },
    });

    // Officer completes onboarding
    const onboardRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/onboarding/complete`,
      headers: { authorization: `Bearer ${officerToken}` },
      payload: { agreedToRules: true },
    });
    expect(onboardRes.statusCode).toBe(200);
    expect(JSON.parse(onboardRes.payload).member.hasCompletedOnboarding).toBe(true);
  });

  it('assigns officer clearance and verifies hierarchy kick protection', async () => {
    // Owner assigns officer role to officer
    const assignRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/clearances/members/${officerId}/assign`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { clearanceId: officerRoleId, action: 'add' },
    });
    expect(assignRes.statusCode).toBe(200);

    // Officer (rank 10) attempts to kick Owner -> 403 FORBIDDEN_HIERARCHY
    const kickOwnerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/members/${ownerId}/kick`,
      headers: { authorization: `Bearer ${officerToken}` },
    });
    expect(kickOwnerRes.statusCode).toBe(403);
    expect(JSON.parse(kickOwnerRes.payload).code).toBe('FORBIDDEN_HIERARCHY');

    // Officer (rank 10) kicks Cadet (rank 0) -> Allowed
    const kickCadetRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${createdBeaconId}/members/${cadetId}/kick`,
      headers: { authorization: `Bearer ${officerToken}` },
    });
    expect(kickCadetRes.statusCode).toBe(200);
  });

  it('manages Beacon Clusters (folders in Beacon list)', async () => {
    // Create folder
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/clusters',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'Federation Hubs',
        color: '#00F0FF',
        position: 0,
        beaconIds: [createdBeaconId],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const cluster = JSON.parse(createRes.payload).cluster;
    expect(cluster.name).toBe('Federation Hubs');
    expect(cluster.beaconIds).toContain(createdBeaconId);

    // List clusters
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/clusters',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.payload).clusters.length).toBeGreaterThanOrEqual(1);

    // Delete cluster
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/clusters/${cluster.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(delRes.statusCode).toBe(200);
  });

  it('queries the discovery index for discoverable beacons', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/beacons/discovery?q=Starbase',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.beacons.some((b: any) => b.name === 'Starbase 12')).toBe(true);
  });
});
