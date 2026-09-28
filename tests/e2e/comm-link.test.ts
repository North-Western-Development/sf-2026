import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, jwt } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import { transmitters, beacons, beaconMembers, clearances, relays, eq } from '@subspace/database';

describe('Comm-Link Audio, Video & Holo-Cast E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'subspace_secret_key_frequency';
  let app: FastifyInstance;

  const pilotId = '12121212-1212-1212-1212-121212121212'; // Has CONNECT_AUDIO, SPEAK_AUDIO, BROADCAST_HOLO_CAST
  const listenerId = '34343434-3434-3434-3434-343434343434'; // Has CONNECT_AUDIO only
  const mutedId = '56565656-5656-5656-5656-565656565656'; // No voice permissions (Text only)

  let pilotToken: string;
  let listenerToken: string;
  let mutedToken: string;

  let beaconId: string;
  let commLinkRelayId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    const db = (app as any).db;
    if (db) {
      const users = [
        { id: pilotId, username: 'pilot_tom', email: 'tom@starfleet.net', passwordHash: 'hash', displayName: 'Pilot Tom' },
        { id: listenerId, username: 'listener_harry', email: 'harry@starfleet.net', passwordHash: 'hash', displayName: 'Harry Kim' },
        { id: mutedId, username: 'chatter_neelix', email: 'neelix@starfleet.net', passwordHash: 'hash', displayName: 'Neelix' },
      ];
      for (const u of users) {
        const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
        if (existing.length === 0) {
          await db.insert(transmitters).values(u);
        }
      }
    }

    pilotToken = signAccessToken({ transmitterId: pilotId, username: 'pilot_tom', staffRank: 0 }, JWT_SECRET);
    listenerToken = signAccessToken({ transmitterId: listenerId, username: 'listener_harry', staffRank: 0 }, JWT_SECRET);
    mutedToken = signAccessToken({ transmitterId: mutedId, username: 'chatter_neelix', staffRank: 0 }, JWT_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets up a Beacon, Clearances, and a Comm-Link Relay', async () => {
    // 1. Create Beacon (pilot is owner)
    const bRes = await app.inject({
      method: 'POST',
      url: '/api/v1/beacons',
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { name: 'USS Voyager Comm-Bay', isDiscoverable: true },
    });
    expect(bRes.statusCode).toBe(201);
    beaconId = JSON.parse(bRes.payload).beacon.id;

    // 2. Add listener & chatter to beacon with onboarding complete
    for (const [tId, token] of [[listenerId, listenerToken], [mutedId, mutedToken]] as const) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/beacons/${beaconId}/join`,
        headers: { authorization: `Bearer ${token}` },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/beacons/${beaconId}/onboarding/complete`,
        headers: { authorization: `Bearer ${token}` },
        payload: { agreedToRules: true },
      });
    }

    // 3. Create a Role with CONNECT_AUDIO for listener
    const listenerRoleBits = (PERMISSIONS.VIEW_RELAY | PERMISSIONS.CONNECT_AUDIO).toString();
    const cRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/clearances`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        name: 'Audio Listener',
        position: 5,
        permissions: listenerRoleBits,
      },
    });
    expect(cRes.statusCode).toBe(201);
    const listenerRoleId = JSON.parse(cRes.payload).clearance.id;

    // Assign role to listener
    await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/clearances/members/${listenerId}/assign`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { clearanceId: listenerRoleId, action: 'add' },
    });

    // 4. Create Comm-Link Relay
    const rRes = await app.inject({
      method: 'POST',
      url: `/api/v1/beacons/${beaconId}/relays`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        name: 'bridge-comm-link',
        type: 'comm_link',
        topic: 'Bridge Audio, Video & Holo-Cast channel',
      },
    });
    expect(rRes.statusCode).toBe(201);
    commLinkRelayId = JSON.parse(rRes.payload).relay.id;
  });

  it('rejects Comm-Link token generation for transmitters lacking CONNECT_AUDIO clearance', async () => {
    // Strip default voice permissions from @everyone so chatter has no voice permissions
    const db = (app as any).db;
    const textOnlyBits = (PERMISSIONS.VIEW_RELAY | PERMISSIONS.SEND_TRANSMISSIONS).toString();
    const [everyone] = await db
      .select()
      .from(clearances)
      .where(eq(clearances.beaconId, beaconId));

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/beacons/${beaconId}/clearances/${everyone.id}`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { permissions: textOnlyBits },
    });

    // Chatter (Neelix) attempts to join Comm-Link audio -> 403 FORBIDDEN_CLEARANCE
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${commLinkRelayId}/comm-link/token`,
      headers: { authorization: `Bearer ${mutedToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).code).toBe('FORBIDDEN_CLEARANCE');
  });

  it('issues signed LiveKit WebRTC tokens with granular audio and Holo-Cast publishing grants', async () => {
    // 1. Pilot (Owner) requests token -> gets microphone + camera + screen_share
    const pilotRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${commLinkRelayId}/comm-link/token`,
      headers: { authorization: `Bearer ${pilotToken}` },
    });

    expect(pilotRes.statusCode).toBe(200);
    const pilotBody = JSON.parse(pilotRes.payload);
    expect(pilotBody.token).toBeDefined();
    expect(pilotBody.canSpeak).toBe(true);
    expect(pilotBody.canHoloCast).toBe(true);

    // Verify JWT payload signature and grants
    const decodedPilot: any = jwt.verify(pilotBody.token, LIVEKIT_API_SECRET);
    expect(decodedPilot.sub).toBe(pilotId);
    expect(decodedPilot.video.roomJoin).toBe(true);
    expect(decodedPilot.video.canPublishSources).toContain('microphone');
    expect(decodedPilot.video.canPublishSources).toContain('screen_share');

    // 2. Listener requests token -> can connect and listen, but cannot speak or screenshare
    const listenerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${commLinkRelayId}/comm-link/token`,
      headers: { authorization: `Bearer ${listenerToken}` },
    });

    expect(listenerRes.statusCode).toBe(200);
    const listenerBody = JSON.parse(listenerRes.payload);
    expect(listenerBody.canSpeak).toBe(false);
    expect(listenerBody.canHoloCast).toBe(false);

    const decodedListener: any = jwt.verify(listenerBody.token, LIVEKIT_API_SECRET);
    expect(decodedListener.sub).toBe(listenerId);
    expect(decodedListener.video.roomJoin).toBe(true);
    expect(decodedListener.video.canPublishSources).toHaveLength(0);
  });

  it('allows text transmissions in the embedded subchannel WITHOUT requiring voice participation', async () => {
    // Chatter (Neelix) has NO voice connection or clearance, but CAN chat in the embedded subchannel
    const msgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relays/${commLinkRelayId}/transmissions`,
      headers: { authorization: `Bearer ${mutedToken}` },
      payload: {
        content: 'Coffee and rations available in the mess hall during this briefing!',
      },
    });

    expect(msgRes.statusCode).toBe(201);
    const body = JSON.parse(msgRes.payload);
    expect(body.transmission.content).toContain('Coffee and rations');

    // Reading subchannel transmissions
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/relays/${commLinkRelayId}/transmissions`,
      headers: { authorization: `Bearer ${listenerToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.payload);
    expect(listBody.transmissions.some((t: any) => t.content.includes('Coffee and rations'))).toBe(true);
  });
});
