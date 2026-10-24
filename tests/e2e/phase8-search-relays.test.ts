import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { PERMISSIONS } from '@subspace/constants';
import {
  transmitters,
  beacons,
  beaconMembers,
  clearances,
  relays,
  archivalThreads,
  transmitterRelayPreferences,
  transmissions,
  vaultFiles,
  eq,
} from '@subspace/database';

describe('Phase 8: Archival, Visual Relays & Subspace Search E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const commanderId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const explorerId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  /** Insert a vault file record owned by `ownerId` and return its id. */
  async function seedVaultFile(ownerId: string, filename: string, mimeType: string): Promise<string> {
    const [file] = await (app as any).db
      .insert(vaultFiles)
      .values({ transmitterId: ownerId, storageKey: `test/${Date.now()}-${filename}`, filename, mimeType, sizeBytes: 1048576n })
      .returning();
    return file.id;
  }

  let commanderToken: string;
  let explorerToken: string;

  let beaconId: string;
  let archivalRelayId: string;
  let visualRelayId: string;
  let normalRelayId: string;
  let unhideableRelayId: string;

  beforeAll(async () => {
    app = await buildApp();
    const db = (app as any).db;
    if (!db) throw new Error('Database not initialized');

    commanderToken = signAccessToken(
      { transmitterId: commanderId, username: 'commander_zane', staffRank: 0 },
      JWT_SECRET
    );
    explorerToken = signAccessToken(
      { transmitterId: explorerId, username: 'explorer_lyra', staffRank: 0 },
      JWT_SECRET
    );

    // Clean up
    await db.delete(transmissions);
    await db.delete(archivalThreads);
    await db.delete(transmitterRelayPreferences);
    await db.delete(relays);
    await db.delete(beaconMembers);
    await db.delete(clearances);
    await db.delete(beacons);
    await db.delete(transmitters);

    // Seed Transmitters
    await db.insert(transmitters).values([
      {
        id: commanderId,
        username: 'commander_zane',
        email: 'commander@subspace.local',
        passwordHash: 'argon_hash_placeholder',
        displayName: 'Commander Zane',
      },
      {
        id: explorerId,
        username: 'explorer_lyra',
        email: 'explorer@subspace.local',
        passwordHash: 'argon_hash_placeholder',
        displayName: 'Explorer Lyra',
      },
    ]);

    // Seed Beacon
    const [b] = await db
      .insert(beacons)
      .values({
        name: 'Andromeda Forward Base',
        description: 'Deep space outpost on the rim of the galaxy',
        ownerId: commanderId,
      })
      .returning();
    beaconId = b.id;

    // Seed @everyone clearance
    const [everyone] = await db
      .insert(clearances)
      .values({
        beaconId,
        name: '@everyone',
        position: 0,
        permissions:
          PERMISSIONS.VIEW_RELAY |
          PERMISSIONS.SEND_TRANSMISSIONS |
          PERMISSIONS.ATTACH_FILES,
      })
      .returning();

    // Add members
    await db.insert(beaconMembers).values([
      {
        beaconId,
        transmitterId: commanderId,
        hasCompletedOnboarding: true,
        clearanceIds: [],
      },
      {
        beaconId,
        transmitterId: explorerId,
        hasCompletedOnboarding: true,
        clearanceIds: [],
      },
    ]);

    // Seed Relays
    const [rArchival] = await db
      .insert(relays)
      .values({
        beaconId,
        name: 'mission-briefings',
        type: 'archival',
        topic: 'Archival research and expedition logs',
        position: 1,
        isUnhideable: false,
      })
      .returning();
    archivalRelayId = rArchival.id;

    const [rVisual] = await db
      .insert(relays)
      .values({
        beaconId,
        name: 'stellar-cartography',
        type: 'visual',
        topic: 'Visual maps and telescope imagery',
        position: 2,
        isUnhideable: false,
      })
      .returning();
    visualRelayId = rVisual.id;

    const [rNormal] = await db
      .insert(relays)
      .values({
        beaconId,
        name: 'general-comm',
        type: 'text',
        topic: 'Casual chatter across the fleet',
        position: 3,
        isUnhideable: false,
      })
      .returning();
    normalRelayId = rNormal.id;

    const [rUnhideable] = await db
      .insert(relays)
      .values({
        beaconId,
        name: 'emergency-protocols',
        type: 'text',
        topic: 'Mandatory emergency broadcast relay',
        position: 0,
        isUnhideable: true,
      })
      .returning();
    unhideableRelayId = rUnhideable.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Archival Relays (Forum Threads)', () => {
    let threadId: string;

    it('creates an archival thread with initial root transmission, tags, and title', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/relays/${archivalRelayId}/archival/threads`,
        headers: { authorization: `Bearer ${explorerToken}` },
        payload: {
          title: 'Project Nebula Discovery',
          content: 'Initial scan telemetry reveals hyperdense neutron remnants at sector 9.',
          tags: ['telemetry', 'nebula', 'anomaly'],
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.thread.title).toBe('Project Nebula Discovery');
      expect(data.thread.tags).toEqual(['telemetry', 'nebula', 'anomaly']);
      expect(data.thread.transmissionCount).toBe(1);
      expect(data.rootTransmission.content).toContain('Initial scan telemetry');
      threadId = data.thread.id;
    });

    it('posts replies into an archival thread and updates count', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/relays/${archivalRelayId}/archival/threads/${threadId}/transmissions`,
        headers: { authorization: `Bearer ${commanderToken}` },
        payload: {
          content: 'Acknowledged Lyra, dispatching probe droid to verify coordinates.',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.transmission.threadId).toBe(threadId);

      // Verify thread transmissions list
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/v1/relays/${archivalRelayId}/archival/threads/${threadId}/transmissions`,
        headers: { authorization: `Bearer ${explorerToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().transmissions.length).toBe(2); // Root + reply
    });

    it('allows beacon owner to pin and lock thread', async () => {
      const pinRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/relays/${archivalRelayId}/archival/threads/${threadId}`,
        headers: { authorization: `Bearer ${commanderToken}` },
        payload: { isPinned: true, isLocked: true },
      });

      expect(pinRes.statusCode).toBe(200);
      expect(pinRes.json().thread.isPinned).toBe(true);
      expect(pinRes.json().thread.isLocked).toBe(true);

      // Non-owner without MANAGE_TRANSMISSIONS cannot reply to locked thread
      const blockedReply = await app.inject({
        method: 'POST',
        url: `/api/v1/relays/${archivalRelayId}/archival/threads/${threadId}/transmissions`,
        headers: { authorization: `Bearer ${explorerToken}` },
        payload: { content: 'Trying to speak in locked thread' },
      });
      expect(blockedReply.statusCode).toBe(403);
      expect(blockedReply.json().error).toContain('locked');
    });
  });

  describe('2. Visual Relays (Media Gallery)', () => {
    it('rejects visual relay transmission without media attachments', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/relays/${visualRelayId}/visual/transmissions`,
        headers: { authorization: `Bearer ${explorerToken}` },
        payload: {
          content: 'Just a text message without any image or video',
          attachmentIds: [],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('ATTACHMENT_REQUIRED');
    });

    it('accepts visual relay transmission with media and returns gallery view', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/relays/${visualRelayId}/visual/transmissions`,
        headers: { authorization: `Bearer ${explorerToken}` },
        payload: {
          content: 'High-resolution capture of Horsehead Nebula',
          // Attachments must reference vault files the sender owns (raw URLs are rejected).
          attachmentIds: [await seedVaultFile(explorerId, 'horsehead.png', 'image/png')],
        },
      });

      expect(res.statusCode).toBe(201);

      // Fetch gallery
      const galRes = await app.inject({
        method: 'GET',
        url: `/api/v1/relays/${visualRelayId}/visual/gallery`,
        headers: { authorization: `Bearer ${commanderToken}` },
      });

      expect(galRes.statusCode).toBe(200);
      const gal = galRes.json();
      expect(gal.count).toBe(1);
      expect(gal.gallery[0].caption).toBe('High-resolution capture of Horsehead Nebula');
      expect(gal.gallery[0].attachment.filename).toBe('horsehead.png');
      // Videos and images are told apart by type; the author carries a #tag.
      expect(gal.gallery[0].attachment.mimeType).toBe('image/png');
      expect(gal.gallery[0].author.discriminator).toMatch(/^\d{4}$/);
      expect(typeof gal.canManage).toBe('boolean');

      // The post also moves the relay's unread pointer, like any other transmission.
      const db = (app as any).db;
      if (db) {
        const [row] = await db.select().from(relays).where(eq(relays.id, visualRelayId));
        expect(row.lastTransmissionId).toBe(res.json().transmission.id);
      }
    });
  });

  describe('3. Channel Visibility & Frequency Filtering', () => {
    it('blocks user from hiding an isUnhideable: true core priority relay', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/beacons/${beaconId}/relays/${unhideableRelayId}/visibility`,
        headers: { authorization: `Bearer ${explorerToken}` },
        payload: { isHidden: true },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('RELAY_IS_UNHIDEABLE');
    });

    it('allows user to hide a normal relay and filters it out in visible view', async () => {
      // Hide normal relay
      const hideRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/beacons/${beaconId}/relays/${normalRelayId}/visibility`,
        headers: { authorization: `Bearer ${explorerToken}` },
        payload: { isHidden: true },
      });
      expect(hideRes.statusCode).toBe(200);

      // GET ?filter=visible -> normal relay is hidden, but unhideable remains visible
      const visibleRes = await app.inject({
        method: 'GET',
        url: `/api/v1/beacons/${beaconId}/relays?filter=visible`,
        headers: { authorization: `Bearer ${explorerToken}` },
      });
      expect(visibleRes.statusCode).toBe(200);
      const visibleList = visibleRes.json().relays;
      const ids = visibleList.map((r: any) => r.id);
      expect(ids).not.toContain(normalRelayId);
      expect(ids).toContain(unhideableRelayId);
      expect(ids).toContain(archivalRelayId);

      // GET ?filter=all -> includes all relays with isHidden flag
      const allRes = await app.inject({
        method: 'GET',
        url: `/api/v1/beacons/${beaconId}/relays?filter=all`,
        headers: { authorization: `Bearer ${explorerToken}` },
      });
      expect(allRes.statusCode).toBe(200);
      const allList = allRes.json().relays;
      const hiddenRelay = allList.find((r: any) => r.id === normalRelayId);
      expect(hiddenRelay.isHidden).toBe(true);
    });
  });

  describe('4. Subspace Quick Scan (Ctrl+K)', () => {
    it('returns matching beacons, relays, and transmitters for global quick find', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/search/quick-scan?q=Andromeda',
        headers: { authorization: `Bearer ${explorerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.beacons.length).toBeGreaterThan(0);
      expect(data.beacons[0].name).toBe('Andromeda Forward Base');

      // Search for relay
      const relayRes = await app.inject({
        method: 'GET',
        url: '/api/v1/search/quick-scan?q=emergency',
        headers: { authorization: `Bearer ${explorerToken}` },
      });
      expect(relayRes.statusCode).toBe(200);
      expect(relayRes.json().relays.length).toBeGreaterThan(0);
      expect(relayRes.json().relays[0].name).toBe('emergency-protocols');

      // Search for transmitter
      const userRes = await app.inject({
        method: 'GET',
        url: '/api/v1/search/quick-scan?q=zane',
        headers: { authorization: `Bearer ${explorerToken}` },
      });
      expect(userRes.statusCode).toBe(200);
      expect(userRes.json().transmitters.length).toBeGreaterThan(0);
      expect(userRes.json().transmitters[0].username).toBe('commander_zane');
    });
  });

  describe('5. Subspace Deep Full-Text Transmission Search', () => {
    it('searches transmissions using full-text and filters by query and relay', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/search/transmissions?q=telemetry&beaconId=${beaconId}`,
        headers: { authorization: `Bearer ${commanderToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.count).toBeGreaterThan(0);
      expect(data.transmissions[0].transmission.content).toContain('Initial scan telemetry');
      expect(data.transmissions[0].author.username).toBe('explorer_lyra');
    });

    it('filters transmissions by hasAttachment flag', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/search/transmissions?q=Horsehead&hasAttachment=true`,
        headers: { authorization: `Bearer ${commanderToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.count).toBe(1);
      expect(data.transmissions[0].transmission.attachments.length).toBe(1);
    });
  });
});
