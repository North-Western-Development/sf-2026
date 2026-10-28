import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { transmitters, eq } from '@subspace/database';
import { Redis } from 'ioredis';

describe('Gateway Real-Time Transmission Events Fanout E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const testUser1Id = '141483468158498679';
  const testUser2Id = '924764459060926873';
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

  /** Collect gateway dispatch events published while `action` runs. */
  async function captureBus(action: () => Promise<unknown>): Promise<any[]> {
    const sub = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
    const events: any[] = [];
    try {
      await sub.connect();
    } catch {
      return events; // Redis unavailable: nothing to assert
    }
    await sub.subscribe('gateway:transmission:events');
    sub.on('message', (_c, m) => events.push(JSON.parse(m)));
    await action();
    await new Promise((r) => setTimeout(r, 150));
    await sub.quit();
    return events;
  }

  it('provisions a beacon and text relay for transmission fanout testing', async () => {
    if (!(app as any).db) return;
    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${user1Token}` },
      payload: { name: 'Delta Quadrant Gateway', isDiscoverable: true },
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
    let txRes: any;
    const events = await captureBus(async () => {
      txRes = await app.inject({
        method: 'POST',
        url: `/api/v1/relays/${textRelayId}/transmissions`,
        headers: { authorization: `Bearer ${user1Token}` },
        payload: {
          content: 'Engage sub-space comms array now. Verified.',
        },
      });
    });
    if ((app as any).redis) {
      const created = events.find((e) => e.type === 'TRANSMISSION_CREATE');
      expect(created).toBeDefined();
      // Audience = everyone in the beacon who can view the relay, and nobody else.
      expect(new Set(created.audience)).toEqual(new Set([testUser1Id, testUser2Id]));
    }

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
    let updateRes: any;
    const events = await captureBus(async () => {
      updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transmissions/${messageId}`,
      headers: { authorization: `Bearer ${user1Token}` },
      payload: { content: 'Updated transmission payload (amended)' },
    });
    });
    if ((app as any).redis) {
      const updated = events.find((e) => e.type === 'TRANSMISSION_UPDATE');
      expect(updated?.transmission.id).toBe(messageId);
      expect(new Set(updated.audience)).toEqual(new Set([testUser1Id, testUser2Id]));
    }

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().transmission.content).toBe('Updated transmission payload (amended)');
    expect(updateRes.json().transmission.isEdited).toBe(true);
  });
});
