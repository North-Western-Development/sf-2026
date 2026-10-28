import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import {
  transmitters,
  affiliations,
  transmissionRequests,
  pointToPointLinks,
  signalBlacklist,
  eq,
  or,
} from '@subspace/database';

describe('Text Relays, Transmissions & Direct Messaging E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  // Transmitters
  const userAId = '416404954512140970';
  const userBId = '808045449963355067';
  const userCId = '299685945414569164'; // Non-shared beacon user

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;

  let beaconId: string;
  let relayId: string;
  let transmissionId: string;
  let requestId: string;
  let meshId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    const db = (app as any).db;
    if (db) {
      const users = [
        { id: userAId, username: 'user_alpha', email: 'alpha@subspace.net', passwordHash: 'hash', displayName: 'Alpha' },
        { id: userBId, username: 'user_beta', email: 'beta@subspace.net', passwordHash: 'hash', displayName: 'Beta' },
        { id: userCId, username: 'user_gamma', email: 'gamma@subspace.net', passwordHash: 'hash', displayName: 'Gamma' },
      ];
      for (const u of users) {
        const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
        if (existing.length === 0) {
          await db.insert(transmitters).values(u);
        }
      }

      // Clean up previous test runs for these users
      await db.delete(affiliations).where(
        or(
          eq(affiliations.transmitterId, userAId),
          eq(affiliations.transmitterId, userBId),
          eq(affiliations.transmitterId, userCId),
          eq(affiliations.targetId, userAId),
          eq(affiliations.targetId, userBId),
          eq(affiliations.targetId, userCId)
        )
      );

      await db.delete(transmissionRequests).where(
        or(
          eq(transmissionRequests.senderId, userAId),
          eq(transmissionRequests.senderId, userBId),
          eq(transmissionRequests.senderId, userCId),
          eq(transmissionRequests.recipientId, userAId),
          eq(transmissionRequests.recipientId, userBId),
          eq(transmissionRequests.recipientId, userCId)
        )
      );

      await db.delete(pointToPointLinks).where(
        or(
          eq(pointToPointLinks.transmitter1Id, userAId),
          eq(pointToPointLinks.transmitter1Id, userBId),
          eq(pointToPointLinks.transmitter1Id, userCId),
          eq(pointToPointLinks.transmitter2Id, userAId),
          eq(pointToPointLinks.transmitter2Id, userBId),
          eq(pointToPointLinks.transmitter2Id, userCId)
        )
      );

      await db.delete(signalBlacklist).where(
        or(
          eq(signalBlacklist.transmitterId, userAId),
          eq(signalBlacklist.transmitterId, userBId),
          eq(signalBlacklist.transmitterId, userCId)
        )
      );
    }

    tokenA = signAccessToken({ transmitterId: userAId, username: 'user_alpha', staffRank: 0 }, JWT_SECRET);
    tokenB = signAccessToken({ transmitterId: userBId, username: 'user_beta', staffRank: 0 }, JWT_SECRET);
    tokenC = signAccessToken({ transmitterId: userCId, username: 'user_gamma', staffRank: 0 }, JWT_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets up a shared Beacon and a Text Relay', async () => {
    // User A establishes Beacon
    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Comms Relay Station 9', isDiscoverable: true },
    });
    expect(bRes.statusCode).toBe(201);
    beaconId = JSON.parse(bRes.payload).beacon.id;

    // User B joins Beacon and completes onboarding
    await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/join`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/onboarding/complete`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { agreedToRules: true },
    });

    // Create Text Relay
    const rRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'general-transmissions', topic: 'Main subspace channel' },
    });
    expect(rRes.statusCode).toBe(201);
    relayId = JSON.parse(rRes.payload).relay.id;
  });

  it('enforces 2000-character transmission length constraint', async () => {
    // 1. Exactly 2000 characters -> succeeds
    const exact2000 = 'x'.repeat(2000);
    const validRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: exact2000 },
    });
    expect(validRes.statusCode).toBe(201);
    transmissionId = JSON.parse(validRes.payload).transmission.id;

    // 2. 2001 characters -> rejected 400 TRANSMISSION_EXCEEDS_LENGTH
    const over2000 = 'x'.repeat(2001);
    const invalidRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: over2000 },
    });
    expect(invalidRes.statusCode).toBe(400);
    expect(JSON.parse(invalidRes.payload).code).toBe('TRANSMISSION_EXCEEDS_LENGTH');
  });

  it('edits and deletes transmissions in a text relay', async () => {
    // Author edits transmission
    const editRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transmissions/${transmissionId}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'Updated transmission content' },
    });
    expect(editRes.statusCode).toBe(200);
    expect(JSON.parse(editRes.payload).transmission.isEdited).toBe(true);

    // List transmissions
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/relays/${relayId}/transmissions`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.payload).transmissions.length).toBeGreaterThanOrEqual(1);

    // Delete transmission
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/transmissions/${transmissionId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(delRes.statusCode).toBe(200);
  });

  it('enforces Transmission Request Gate rules (1 msg, 7d expiry, mutual beacon check)', async () => {
    // 1. User C (no shared beacon with User B) attempts to message User B -> 403 NO_SHARED_BEACON
    const noSharedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/links/${userBId}/transmissions`,
      headers: { authorization: `Bearer ${tokenC}` },
      payload: { content: 'Hello stranger' },
    });
    expect(noSharedRes.statusCode).toBe(403);
    expect(JSON.parse(noSharedRes.payload).code).toBe('NO_SHARED_BEACON');

    // 2. User A (shares beacon with B, but not friends yet) sends 1st introductory transmission -> succeeds
    const req1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/links/${userBId}/transmissions`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'Introductory transmission request' },
    });
    expect(req1Res.statusCode).toBe(201);
    const body = JSON.parse(req1Res.payload);
    expect(body.isIntroductoryRequest).toBe(true);
    requestId = body.request.id;

    // 3. User A attempts 2nd transmission before acceptance -> 403 TRANSMISSION_REQUEST_PENDING
    const req2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/links/${userBId}/transmissions`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'Second message should be blocked' },
    });
    expect(req2Res.statusCode).toBe(403);
    expect(JSON.parse(req2Res.payload).code).toBe('TRANSMISSION_REQUEST_PENDING');

    // 4. User B accepts transmission request -> unlocks full two-way DM
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/requests/${requestId}/accept`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(acceptRes.statusCode).toBe(200);

    // 5. User A can now send standard continuous DMs
    const dmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/links/${userBId}/transmissions`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'Now we can transmit freely' },
    });
    expect(dmRes.statusCode).toBe(201);
    expect(JSON.parse(dmRes.payload).linkId).toBeDefined();
    // The DM carries its author (the same object goes out on the gateway), so a recipient can
    // name a sender it has never seen; private fields never ride along.
    const author = JSON.parse(dmRes.payload).transmission.author;
    expect(author.id).toBe(userAId);
    expect(author.username).toBeTruthy();
    expect(author.email).toBeUndefined();
    expect(author.passwordHash).toBeUndefined();
  });

  it('manages Affiliation Requests with greeting notes', async () => {
    // 1. Note exceeding 200 chars -> rejected
    const longNote = 'A'.repeat(201);
    const invalidNoteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/affiliations/request',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { targetId: userCId, greetingNote: longNote },
    });
    expect(invalidNoteRes.statusCode).toBe(400);
    expect(JSON.parse(invalidNoteRes.payload).code).toBe('GREETING_NOTE_EXCEEDS_LENGTH');

    // 2. Valid request with greeting note
    const validNote = 'Greetings! Honored to request subspace affiliation.';
    const validNoteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/affiliations/request',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { targetId: userCId, greetingNote: validNote },
    });
    expect(validNoteRes.statusCode).toBe(201);
    const aff = JSON.parse(validNoteRes.payload).affiliation;
    expect(aff.greetingNote).toBe(validNote);
    expect(aff.status).toBe('pending');

    // 3. User C accepts
    const acceptAff = await app.inject({
      method: 'POST',
      url: `/api/v1/affiliations/${aff.id}/accept`,
      headers: { authorization: `Bearer ${tokenC}` },
    });
    expect(acceptAff.statusCode).toBe(200);
  });

  it('verifies Signal Blacklist blocking behavior', async () => {
    // User B blacklists User C
    const blockRes = await app.inject({
      method: 'POST',
      url: '/api/v1/blacklist',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { targetId: userCId, targetType: 'transmitter' },
    });
    expect(blockRes.statusCode).toBe(201);

    // User C attempts to message User B -> 403 SIGNAL_BLOCKED
    const blockedMsgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/links/${userBId}/transmissions`,
      headers: { authorization: `Bearer ${tokenC}` },
      payload: { content: 'Are you getting this?' },
    });
    expect(blockedMsgRes.statusCode).toBe(403);
    expect(JSON.parse(blockedMsgRes.payload).code).toBe('SIGNAL_BLOCKED');

    // Unblock
    const unblockRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/blacklist/${userCId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(unblockRes.statusCode).toBe(200);
  });

  it('creates and manages Subspace Meshes (Group DMs with max 10 members)', async () => {
    // Mesh membership requires affiliation with the creator (Discord parity contract §5).
    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/affiliations/request',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { targetId: userBId },
    });
    const affId = JSON.parse(reqRes.payload).affiliation.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/affiliations/${affId}/accept`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    // 1. Exceeding 10 members -> rejected
    const tooManyMembers = [
      '491640495451214097',
      '883280990902428194',
      '374921486353642291',
      '766561981804856388',
      '258202477256070485',
      '649842972707284582',
      '141483468158498679',
      '533123963609712776',
      '924764459060926873',
      '651803472605802222',
    ];
    const invalidMeshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/meshes',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Giant Mesh', memberIds: tooManyMembers },
    });
    expect(invalidMeshRes.statusCode).toBe(400);
    expect(JSON.parse(invalidMeshRes.payload).code).toBe('MESH_CAPACITY_EXCEEDED');

    // 2. Valid Mesh with 2 members
    const validMeshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/meshes',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Squad Mesh Alpha', memberIds: [userBId] },
    });
    expect(validMeshRes.statusCode).toBe(201);
    meshId = JSON.parse(validMeshRes.payload).mesh.id;

    // 3. Post transmission to Mesh
    const msgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/meshes/${meshId}/transmissions`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { content: 'Mesh broadcast online.' },
    });
    expect(msgRes.statusCode).toBe(201);

    // 4. Retrieve Mesh transmissions
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/meshes/${meshId}/transmissions`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.payload).transmissions.length).toBe(1);
  });
});
