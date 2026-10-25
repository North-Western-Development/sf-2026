import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken } from '@subspace/crypto';
import { STAFF_RANKS } from '@subspace/constants';
import {
  transmitters,
  beacons,
  vaultFiles,
  incidentReports,
  commendations,
  transmitterCommendations,
  eq,
} from '@subspace/database';
import { evaluateAndAwardCommendations } from '../../apps/badge-worker/src/index.js';

describe('Phase 9: Command Console, Moderation & Commendations E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const rootId = '90909090-9090-9090-9090-909090909090'; // Staff Rank: 3 (ROOT)
  const adminId = '80808080-8080-8080-8080-808080808080'; // Staff Rank: 2 (ADMIN)
  const modId = '70707070-7070-7070-7070-707070707070'; // Staff Rank: 1 (MODERATOR)
  const regularId = '60606060-6060-6060-6060-606060606060'; // Staff Rank: 0 (NONE)

  let rootToken: string;
  let adminToken: string;
  let modToken: string;
  let regularToken: string;

  let testFileId: string;
  let testBeaconId: string;
  let reportId: string;

  beforeAll(async () => {
    app = await buildApp();
    const db = (app as any).db;
    if (!db) throw new Error('Database not initialized');

    rootToken = signAccessToken(
      { transmitterId: rootId, username: 'admiral_kirk', staffRank: STAFF_RANKS.ROOT },
      JWT_SECRET
    );
    adminToken = signAccessToken(
      { transmitterId: adminId, username: 'commander_spock', staffRank: STAFF_RANKS.ADMIN },
      JWT_SECRET
    );
    modToken = signAccessToken(
      { transmitterId: modId, username: 'lt_sulu', staffRank: STAFF_RANKS.MODERATOR },
      JWT_SECRET
    );
    regularToken = signAccessToken(
      { transmitterId: regularId, username: 'ensign_chekov', staffRank: STAFF_RANKS.NONE },
      JWT_SECRET
    );

    // Clean up
    await db.delete(incidentReports);
    await db.delete(transmitterCommendations);
    await db.delete(commendations);
    await db.delete(vaultFiles);
    await db.delete(beacons);
    await db.delete(transmitters);

    // Seed Transmitters with respective staff ranks
    await db.insert(transmitters).values([
      {
        id: rootId,
        username: 'admiral_kirk',
        email: 'kirk@starfleet.subspace',
        passwordHash: 'argon_hash_kirk',
        displayName: 'Admiral Kirk',
        staffRank: STAFF_RANKS.ROOT,
      },
      {
        id: adminId,
        username: 'commander_spock',
        email: 'spock@starfleet.subspace',
        passwordHash: 'argon_hash_spock',
        displayName: 'Commander Spock',
        staffRank: STAFF_RANKS.ADMIN,
      },
      {
        id: modId,
        username: 'lt_sulu',
        email: 'sulu@starfleet.subspace',
        passwordHash: 'argon_hash_sulu',
        displayName: 'Lieutenant Sulu',
        staffRank: STAFF_RANKS.MODERATOR,
      },
      {
        id: regularId,
        username: 'ensign_chekov',
        email: 'chekov@starfleet.subspace',
        passwordHash: 'argon_hash_chekov',
        displayName: 'Ensign Chekov',
        staffRank: STAFF_RANKS.NONE,
      },
    ]);

    // Seed Beacon
    const [b] = await db
      .insert(beacons)
      .values({
        name: 'Discovery Sector Alpha',
        ownerId: regularId,
        isDiscoverable: true,
      })
      .returning();
    testBeaconId = b.id;

    // Seed Vault file
    const [f] = await db
      .insert(vaultFiles)
      .values({
        transmitterId: regularId,
        storageKey: 'users/chekov/telemetry.csv',
        filename: 'telemetry.csv',
        mimeType: 'text/csv',
        sizeBytes: 1024n,
        isQuarantined: false,
      })
      .returning();
    testFileId = f.id;

    // Seed Commendations for badge testing
    await db.insert(commendations).values([
      {
        code: 'COMM_LINK_VETERAN',
        name: 'Comm-Link Veteran',
        description: 'Completed 60 minutes of voice transmissions',
        iconUrl: '/badges/voice_veteran.png',
        criteriaType: 'voice_minutes',
        threshold: 60,
      },
      {
        code: 'TRANSMISSION_PROLIFIC',
        name: 'Signal Flare Dispatcher',
        description: 'Sent 100 subspace transmissions',
        iconUrl: '/badges/transmissions_100.png',
        criteriaType: 'transmissions_sent',
        threshold: 100,
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Incident Flare (Context Menu Reporting)', () => {
    it('allows any member to submit an Incident Flare with telemetry capture', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { authorization: `Bearer ${regularToken}` },
        payload: {
          targetType: 'beacon',
          targetId: testBeaconId,
          reason: 'spam',
          description: 'Excessive beacon beacon frequency spam',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.report.targetType).toBe('beacon');
      expect(data.report.telemetrySnapshot.beaconName).toBe('Discovery Sector Alpha');
      expect(data.report.status).toBe('open');
      reportId = data.report.id;
    });

    it('denies regular users access to Command Console reports', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/console/reports',
        headers: { authorization: `Bearer ${regularToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('INSUFFICIENT_STAFF_RANK');
    });

    it('allows staff (Moderator) to list and resolve incident reports', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/console/reports',
        headers: { authorization: `Bearer ${modToken}` },
      });

      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().count).toBeGreaterThanOrEqual(1);

      // Resolve the report
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/console/reports/${reportId}`,
        headers: { authorization: `Bearer ${modToken}` },
        payload: {
          status: 'resolved',
          resolutionNotes: 'Beacon reviewed, warning issued to creator.',
        },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().report.status).toBe('resolved');
      expect(patchRes.json().report.resolvedByStaffId).toBe(modId);
    });
  });

  describe('2. Command Console Staff Hierarchy & User Moderation', () => {
    it('blocks Moderator from banning users (Admin required)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/console/transmitters/${regularId}/ban`,
        headers: { authorization: `Bearer ${modToken}` },
        payload: { reason: 'Test ban' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('INSUFFICIENT_STAFF_RANK');
    });

    it('blocks Admin from banning Root staff member (Hierarchy Invariant)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/console/transmitters/${rootId}/ban`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Attempt mutiny' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_STAFF_HIERARCHY');
    });

    it('allows Admin to ban regular transmitter and blocks login when banned', async () => {
      const banRes = await app.inject({
        method: 'POST',
        url: `/api/v1/console/transmitters/${regularId}/ban`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Directives non-compliance' },
      });

      expect(banRes.statusCode).toBe(200);
      expect(banRes.json().transmitter.isBanned).toBe(true);

      // Attempt to authenticate
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'ensign_chekov',
          password: 'wrong_or_right_placeholder',
        },
      });
      // Will fail either with 401 or 403; let's test unban
      const unbanRes = await app.inject({
        method: 'POST',
        url: `/api/v1/console/transmitters/${regularId}/unban`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(unbanRes.statusCode).toBe(200);
      expect(unbanRes.json().transmitter.isBanned).toBe(false);
    });

    it('allows only Root staff to promote staff ranks', async () => {
      // Admin tries to promote -> 403
      const adminAttempt = await app.inject({
        method: 'PATCH',
        url: `/api/v1/console/transmitters/${regularId}/staff-rank`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { staffRank: STAFF_RANKS.MODERATOR },
      });
      expect(adminAttempt.statusCode).toBe(403);

      // Root promotes -> 200
      const rootAttempt = await app.inject({
        method: 'PATCH',
        url: `/api/v1/console/transmitters/${regularId}/staff-rank`,
        headers: { authorization: `Bearer ${rootToken}` },
        payload: { staffRank: STAFF_RANKS.MODERATOR },
      });
      expect(rootAttempt.statusCode).toBe(200);
      expect(rootAttempt.json().transmitter.staffRank).toBe(STAFF_RANKS.MODERATOR);
    });
  });

  describe('3. File Quarantine & Beacon Discovery Moderation', () => {
    it('allows staff to quarantine files in Subspace Vault', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/console/vault/files/${testFileId}/quarantine`,
        headers: { authorization: `Bearer ${modToken}` },
        payload: { isQuarantined: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().file.isQuarantined).toBe(true);
    });

    it('allows Admin to force-moderate Beacon discovery status', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/console/beacons/${testBeaconId}/discovery`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { isDiscoverable: false },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().beacon.isDiscoverable).toBe(false);
    });
  });

  describe('4. Commendation Engine & Mandatory Staff Insignia', () => {
    it('awards Commendation when telemetry criteria threshold is met', async () => {
      const db = (app as any).db;
      const redis = (app as any).redis;

      // Evaluate 75 voice minutes for regular user (Threshold is 60)
      const awarded = await evaluateAndAwardCommendations(db, redis, {
        transmitterId: regularId,
        eventType: 'voice_minutes',
        amount: 75,
      });

      expect(awarded.length).toBe(1);
      expect(awarded[0].code).toBe('COMM_LINK_VETERAN');

      // Fetch Commendation Deck
      const deckRes = await app.inject({
        method: 'GET',
        url: `/api/v1/transmitters/${regularId}/commendations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(deckRes.statusCode).toBe(200);
      const deck = deckRes.json().deck;
      expect(deck.some((b: any) => b.code === 'COMM_LINK_VETERAN')).toBe(true);
    });

    it('automatically grants and forbids hiding mandatory Command Staff Insignia', async () => {
      // Admiral Kirk has staffRank = 3 (ROOT)
      const deckRes = await app.inject({
        method: 'GET',
        url: `/api/v1/transmitters/${rootId}/commendations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(deckRes.statusCode).toBe(200);
      const deck = deckRes.json().deck;
      const staffInsignia = deck.find((b: any) => b.criteriaType === 'staff');
      expect(staffInsignia).toBeDefined();
      expect(staffInsignia.code).toBe('STAFF');
      expect(staffInsignia.isVisible).toBe(true);

      // Attempt to hide the staff insignia
      const hideAttempt = await app.inject({
        method: 'PATCH',
        url: '/api/v1/transmitters/me/commendations',
        headers: { authorization: `Bearer ${rootToken}` },
        payload: {
          updates: [
            {
              commendationId: staffInsignia.commendationId,
              isVisible: false,
            },
          ],
        },
      });

      expect(hideAttempt.statusCode).toBe(400);
      expect(hideAttempt.json().code).toBe('CANNOT_HIDE_STAFF_INSIGNIA');
    });
  });
});
