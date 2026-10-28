import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, beacons, beaconMembers, clearances, relays, eq } from '@subspace/database';

describe('LiveKit SFU Signaling & Comm-Link Contract E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const commanderId = '533123963609712776';
  let commanderToken: string;
  let beaconId: string;
  let commLinkRelayId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    const db = (app as any).db;
    if (db) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, commanderId)).limit(1);
      if (existing.length === 0) {
        await db.insert(transmitters).values({
          id: commanderId,
          username: 'cmdr_sisko',
          email: 'sisko@deepspace9.net',
          passwordHash: 'hash',
          displayName: 'Commander Sisko',
        });
      }
    }

    commanderToken = signAccessToken({ transmitterId: commanderId, username: 'cmdr_sisko', staffRank: 3 }, JWT_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('provisions a beacon and a comm_link relay for LiveKit signaling', async () => {
    if (!(app as any).db) return;
    // 1. Create Beacon
    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${commanderToken}` },
      payload: { name: 'Deep Space Station 9' },
    });
    expect(bRes.statusCode).toBe(201);
    beaconId = bRes.json().beacon.id;

    // 2. Create Comm-Link Voice Relay
    const rRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${commanderToken}` },
      payload: {
        name: 'ops-tactical-comm',
        type: 'comm_link',
        topic: 'Command operations audio link',
      },
    });
    expect(rRes.statusCode).toBe(201);
    commLinkRelayId = rRes.json().relay.id;
  });

  it('issues a valid LiveKit SFU access token with required claims and permissions', async () => {
    if (!(app as any).db) return;
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${commLinkRelayId}/comm-link/token`,
      headers: { authorization: `Bearer ${commanderToken}` },
    });

    expect(tokenRes.statusCode).toBe(200);
    const body = tokenRes.json();

    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
    expect(body.roomName).toBe(commLinkRelayId);
    expect(body.canSpeak).toBe(true);
    expect(body.canShareScreen).toBe(true);
    expect(body.livekitUrl).toBeDefined();
  });

  it('rejects access token requests for non-comm-link text relays', async () => {
    if (!(app as any).db) return;
    // Create text relay
    const textRelayRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${commanderToken}` },
      payload: {
        name: 'promenade-chatter',
        type: 'text',
      },
    });
    const textRelayId = textRelayRes.json().relay.id;

    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${textRelayId}/comm-link/token`,
      headers: { authorization: `Bearer ${commanderToken}` },
    });

    expect(tokenRes.statusCode).toBe(400);
    expect(tokenRes.json().code).toBe('NOT_A_COMM_LINK_RELAY');
  });
});
