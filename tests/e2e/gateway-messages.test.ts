import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { transmitters, eq } from '@subspace/database';

describe('Gateway Real-Time Transmission Events Fanout E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const testUser1Id = '77777777-7777-7777-7777-777777777777';
  const testUser2Id = '99999999-9999-9999-9999-999999999999';
  let user1Token: string;
  let user2Token: string;

  let beaconId: string;
  let textRelayId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    const db = (app as any).db;
    if (db) {
      const users = [
        { id: testUser1Id, username: 'operator_janeway', email: 'janeway@subspace.net', passwordHash: 'hash', displayName: 'Captain Janeway' },
        { id: testUser2Id, username: 'operator_chakotay', email: 'chakotay@subspace.net', passwordHash: 'hash', displayName: 'Commander Chakotay' },
      ];
      for (const u of users) {
        const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
        if (existing.length === 0) {
          await db.insert(transmitters).values(u);
        }
      }
    }

    user1Token = signAccessToken({ transmitterId: testUser1Id, username: 'operator_janeway', staffRank: 3 }, JWT_SECRET);
    user2Token = signAccessToken({ transmitterId: testUser2Id, username: 'operator_chakotay', staffRank: 2 }, JWT_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('provisions a beacon and text relay for transmission fanout testing', async () => {
    if (!(app as any).db) return;
    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${user1Token}` },
      payload: { name: 'Delta Quadrant Gateway' },
    });
    expect(bRes.statusCode).toBe(201);
    beaconId = bRes.json().beacon.id;

    // Join user2 to beacon
    await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/join`,
      headers: { authorization: `Bearer ${user2Token}` },
    });

    const rRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${user1Token}` },
      payload: {
        name: 'quantum-link-stream',
        type: 'text',
      },
    });
    expect(rRes.statusCode).toBe(201);
    textRelayId = rRes.json().relay.id;
  });

  it('dispatches a new transmission and publishes TRANSMISSION_CREATE event to Redis bus', async () => {
    if (!(app as any).db) return;
    const txRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${textRelayId}/transmissions`,
      headers: { authorization: `Bearer ${user1Token}` },
      payload: {
        content: 'Engage sub-space comms array now. Verified.',
      },
    });

    expect(txRes.statusCode).toBe(201);
    const body = txRes.json();
    expect(body.transmission).toBeDefined();
    expect(body.transmission.content).toBe('Engage sub-space comms array now. Verified.');
    expect(body.transmission.relayId).toBe(textRelayId);
  });

  it('dispatches transmission updates and publishes TRANSMISSION_UPDATE event', async () => {
    if (!(app as any).db) return;
    // 1. Create message
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${textRelayId}/transmissions`,
      headers: { authorization: `Bearer ${user1Token}` },
      payload: { content: 'Initial transmission payload' },
    });
    const messageId = createRes.json().transmission.id;

    // 2. Update message
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/relays/${textRelayId}/transmissions/${messageId}`,
      headers: { authorization: `Bearer ${user1Token}` },
      payload: { content: 'Updated transmission payload (amended)' },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().transmission.content).toBe('Updated transmission payload (amended)');
    expect(updateRes.json().transmission.isEdited).toBe(true);
  });
});
