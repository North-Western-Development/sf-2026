import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  desc,
  ilike,
  beacons,
  beaconMembers,
  clearances,
  transmitters,
  beaconEmojis,
  resolveBeaconAudience,
} from '@subspace/database';
import {
  PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  hasPermission,
} from '@subspace/constants';
import {
  extractAuthToken,
  resolveBeaconActorContext,
  assertCanModerateTarget,
} from '../../middleware/hierarchy.js';
import { publishSessionRefresh } from '../../lib/events.js';

export const beaconRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/beacons
   * Create a new Beacon, create @everyone role at position 0, and add owner as member
   */
  app.post('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    const body = request.body as any;
    const { name, description, iconUrl, bannerUrl, isDiscoverable, suppressCustomFonts, rulesText } =
      body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.status(400).send({ error: 'Beacon name is required' });
    }

    // Insert Beacon
    const [newBeacon] = await db
      .insert(beacons)
      .values({
        name: name.trim(),
        description: description?.trim() || null,
        iconUrl: iconUrl || null,
        bannerUrl: bannerUrl || null,
        ownerId: token.transmitterId,
        isDiscoverable: Boolean(isDiscoverable),
        suppressCustomFonts: Boolean(suppressCustomFonts),
        rulesText: rulesText || 'Welcome to this Beacon. Respect all transmissions.',
      })
      .returning();

    // Create default @everyone clearance at position 0
    const [everyoneClearance] = await db
      .insert(clearances)
      .values({
        beaconId: newBeacon.id,
        name: '@everyone',
        color: '#99AAB5',
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
        allowDelegation: false,
      })
      .returning();

    // Add owner as beacon member with onboarding completed
    const [ownerMember] = await db
      .insert(beaconMembers)
      .values({
        beaconId: newBeacon.id,
        transmitterId: token.transmitterId,
        hasCompletedOnboarding: true,
        clearanceIds: [],
      })
      .returning();

    return reply.status(201).send({
      message: 'Beacon established successfully',
      beacon: newBeacon,
      everyoneClearance: {
        ...everyoneClearance,
        permissions: everyoneClearance.permissions.toString(),
      },
      member: ownerMember,
    });
  });

  /**
   * GET /api/v1/beacons/me
   * List Beacons that the authenticated transmitter has joined
   */
  app.get('/me', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const userBeacons = await db
      .select({
        id: beacons.id,
        name: beacons.name,
        description: beacons.description,
        iconUrl: beacons.iconUrl,
        bannerUrl: beacons.bannerUrl,
        ownerId: beacons.ownerId,
        isDiscoverable: beacons.isDiscoverable,
      })
      .from(beaconMembers)
      .innerJoin(beacons, eq(beaconMembers.beaconId, beacons.id))
      .where(eq(beaconMembers.transmitterId, token.transmitterId));

    return reply.send({ beacons: userBeacons });
  });

  /**
   * GET /api/v1/beacons/discovery
   * List discoverable Beacons
   */
  app.get('/discovery', async (request, reply) => {
    if (!db) {
      return reply.status(503).send({ error: 'Database service unavailable' });
    }

    const query = request.query as any;
    const search = query?.q ? `%${query.q.trim()}%` : null;

    let discoverableBeacons;
    if (search) {
      discoverableBeacons = await db
        .select({
          id: beacons.id,
          name: beacons.name,
          description: beacons.description,
          iconUrl: beacons.iconUrl,
          bannerUrl: beacons.bannerUrl,
          createdAt: beacons.createdAt,
        })
        .from(beacons)
        .where(and(eq(beacons.isDiscoverable, true), ilike(beacons.name, search)))
        .limit(50);
    } else {
      discoverableBeacons = await db
        .select({
          id: beacons.id,
          name: beacons.name,
          description: beacons.description,
          iconUrl: beacons.iconUrl,
          bannerUrl: beacons.bannerUrl,
          createdAt: beacons.createdAt,
        })
        .from(beacons)
        .where(eq(beacons.isDiscoverable, true))
        .limit(50);
    }

    return reply.send({
      beacons: discoverableBeacons,
      count: discoverableBeacons.length,
    });
  });

  /**
   * GET /api/v1/beacons/:id
   * Get Beacon details
   */
  app.get('/:id', async (request, reply) => {
    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(beaconId)) {
      return reply.status(404).send({ error: 'Beacon not found' });
    }

    const [beacon] = await db
      .select()
      .from(beacons)
      .where(eq(beacons.id, beaconId))
      .limit(1);

    if (!beacon) {
      return reply.status(404).send({ error: 'Beacon not found' });
    }

    return reply.send({ beacon });
  });

  /**
   * PATCH /api/v1/beacons/:id
   * Update Beacon configuration
   */
  app.patch('/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.ADMINISTRATOR)) {
      return reply.status(403).send({ error: 'Only owner or administrator may modify Beacon parameters' });
    }

    const body = request.body as any;
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (body.iconUrl !== undefined) updates.iconUrl = body.iconUrl;
    if (body.bannerUrl !== undefined) updates.bannerUrl = body.bannerUrl;
    if (body.isDiscoverable !== undefined) updates.isDiscoverable = Boolean(body.isDiscoverable);
    if (body.suppressCustomFonts !== undefined) updates.suppressCustomFonts = Boolean(body.suppressCustomFonts);
    if (body.rulesText !== undefined) updates.rulesText = body.rulesText;

    const [updatedBeacon] = await db
      .update(beacons)
      .set(updates)
      .where(eq(beacons.id, beaconId))
      .returning();

    return reply.send({
      message: 'Beacon parameters updated',
      beacon: updatedBeacon,
    });
  });

  /**
   * DELETE /api/v1/beacons/:id
   * Delete Beacon (Owner Only)
   */
  app.delete('/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [beacon] = await db
      .select()
      .from(beacons)
      .where(eq(beacons.id, beaconId))
      .limit(1);

    if (!beacon) {
      return reply.status(404).send({ error: 'Beacon not found' });
    }

    if (beacon.ownerId !== token.transmitterId) {
      return reply.status(403).send({ error: 'Only the Beacon owner can decommission this Beacon' });
    }

    await db.delete(beacons).where(eq(beacons.id, beaconId));

    return reply.send({ message: 'Beacon decommissioned successfully' });
  });

  /**
   * POST /api/v1/beacons/:id/join
   * Join a Beacon (defaults to onboarding incomplete)
   */
  app.post('/:id/join', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [beacon] = await db
      .select()
      .from(beacons)
      .where(eq(beacons.id, beaconId))
      .limit(1);

    if (!beacon) {
      return reply.status(404).send({ error: 'Beacon not found' });
    }

    const [existingMember] = await db
      .select()
      .from(beaconMembers)
      .where(
        and(
          eq(beaconMembers.beaconId, beaconId),
          eq(beaconMembers.transmitterId, token.transmitterId)
        )
      )
      .limit(1);

    if (existingMember) {
      return reply.status(409).send({ error: 'Transmitter is already affiliated with this Beacon' });
    }

    const [newMember] = await db
      .insert(beaconMembers)
      .values({
        beaconId,
        transmitterId: token.transmitterId,
        hasCompletedOnboarding: false,
        clearanceIds: [],
      })
      .returning();

    await publishSessionRefresh(app, await resolveBeaconAudience(db, beaconId));

    return reply.status(201).send({
      message: 'Joined Beacon successfully. Onboarding required.',
      member: newMember,
      requiresOnboarding: true,
      rulesText: beacon.rulesText,
    });
  });

  /**
   * POST /api/v1/beacons/:id/leave
   * Leave Beacon
   */
  app.post('/:id/leave', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [beacon] = await db
      .select()
      .from(beacons)
      .where(eq(beacons.id, beaconId))
      .limit(1);

    if (!beacon) return reply.status(404).send({ error: 'Beacon not found' });

    if (beacon.ownerId === token.transmitterId) {
      return reply.status(400).send({
        error: 'Beacon owner cannot depart without transferring ownership',
      });
    }

    await db
      .delete(beaconMembers)
      .where(
        and(
          eq(beaconMembers.beaconId, beaconId),
          eq(beaconMembers.transmitterId, token.transmitterId)
        )
      );

    await publishSessionRefresh(app, [token.transmitterId, ...(await resolveBeaconAudience(db, beaconId))]);

    return reply.send({ message: 'Departed from Beacon' });
  });

  /**
   * GET /api/v1/beacons/:id/members
   * List Beacon members with their display color (overridden by highest clearance color)
   */
  app.get('/:id/members', async (request, reply) => {
    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [beacon] = await db
      .select()
      .from(beacons)
      .where(eq(beacons.id, beaconId))
      .limit(1);

    if (!beacon) return reply.status(404).send({ error: 'Beacon not found' });

    // Fetch members and all clearances in beacon
    const members = await db
      .select({
        transmitterId: beaconMembers.transmitterId,
        nickname: beaconMembers.nickname,
        hasCompletedOnboarding: beaconMembers.hasCompletedOnboarding,
        clearanceIds: beaconMembers.clearanceIds,
        joinedAt: beaconMembers.joinedAt,
        username: transmitters.username,
        discriminator: transmitters.discriminator,
        bio: transmitters.bio,
        bannerUrl: transmitters.bannerUrl,
        bannerColor: transmitters.bannerColor,
        displayName: transmitters.displayName,
        displayColor: transmitters.displayColor,
        displayFont: transmitters.displayFont,
        avatarUrl: transmitters.avatarUrl,
        presence: transmitters.presence,
        customStatus: transmitters.customStatus,
      })
      .from(beaconMembers)
      .innerJoin(transmitters, eq(beaconMembers.transmitterId, transmitters.id))
      .where(eq(beaconMembers.beaconId, beaconId));

    // Masked live presence mirrored by the gateway into Redis; offline (or absent) otherwise.
    const redis = (app as any).redis;
    let presenceMap = new Map<string, string>();
    if (redis && members.length > 0) {
      try {
        const entries = await redis.hmget('presence', ...members.map((m: any) => m.transmitterId));
        members.forEach((m: any, i: number) => {
          if (entries[i]) presenceMap.set(m.transmitterId, entries[i]);
        });
      } catch {
        // Redis unavailable: fall through to offline for everyone.
      }
    }

    const beaconClearances = await db
      .select()
      .from(clearances)
      .where(eq(clearances.beaconId, beaconId));

    const clearanceMap = new Map(beaconClearances.map((c: any) => [c.id, c]));

    const memberList = members.map((m: any) => {
      // Find highest clearance with a custom color
      const userClearances = (m.clearanceIds as string[])
        .map((id) => clearanceMap.get(id))
        .filter(Boolean) as Array<typeof clearances.$inferSelect>;

      userClearances.sort((a, b) => b.position - a.position);
      const highestColoredRole = userClearances.find((c) => c.color && c.color !== '#99AAB5');

      // If beacon suppresses custom fonts, enforce default
      const displayFont = beacon.suppressCustomFonts ? 'default' : m.displayFont;
      const effectiveColor = highestColoredRole ? highestColoredRole.color : m.displayColor;

      return {
        transmitterId: m.transmitterId,
        username: m.username,
        discriminator: m.discriminator,
        bio: m.bio,
        bannerUrl: m.bannerUrl,
        bannerColor: m.bannerColor,
        displayName: m.nickname || m.displayName,
        displayColor: effectiveColor,
        displayFont,
        avatarUrl: m.avatarUrl,
        presence: presenceMap.get(m.transmitterId) || 'offline',
        customStatus: m.customStatus,
        hasCompletedOnboarding: m.hasCompletedOnboarding,
        clearanceIds: m.clearanceIds,
        isOwner: m.transmitterId === beacon.ownerId,
      };
    });

    return reply.send({ members: memberList });
  });

  /**
   * POST /api/v1/beacons/:id/members/:targetId/kick
   * Kick member with strict hierarchy check
   */
  app.post('/:id/members/:targetId/kick', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId, targetId } = request.params as { id: string; targetId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    // Permission bit check
    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.KICK_MEMBERS)) {
      return reply.status(403).send({ error: 'Transmitter lacks KICK_MEMBERS clearance' });
    }

    // Hierarchy authority check
    const canModerate = await assertCanModerateTarget(db, actorContext, targetId, reply);
    if (!canModerate) return;

    // Delete membership
    await db
      .delete(beaconMembers)
      .where(
        and(
          eq(beaconMembers.beaconId, beaconId),
          eq(beaconMembers.transmitterId, targetId)
        )
      );

    await publishSessionRefresh(app, [targetId, ...(await resolveBeaconAudience(db, beaconId))]);

    return reply.send({ message: 'Target transmitter expelled from Beacon' });
  });

  /**
   * GET /api/v1/beacons/:id/emojis
   * List custom emojis for a beacon
   */
  app.get('/:id/emojis', async (request, reply) => {
    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const emojis = await db
      .select()
      .from(beaconEmojis)
      .where(eq(beaconEmojis.beaconId, beaconId));

    return reply.send({ emojis });
  });

  /**
   * POST /api/v1/beacons/:id/emojis
   * Upload / create a custom emoji
   */
  app.post('/:id/emojis', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.ADMINISTRATOR)) {
      return reply.status(403).send({ error: 'Administrator permission required' });
    }

    const { name, url } = request.body as { name: string; url: string };
    if (!name || !url) {
      return reply.status(400).send({ error: 'Emoji name and URL are required' });
    }

    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (!cleanName) {
      return reply.status(400).send({ error: 'Emoji name must be alphanumeric or underscores' });
    }

    const [emoji] = await db
      .insert(beaconEmojis)
      .values({
        beaconId,
        name: cleanName,
        url: url.trim(),
        uploaderId: token.transmitterId,
      })
      .returning();

    return reply.status(201).send({ emoji });
  });

  /**
   * PATCH /api/v1/beacons/:id/emojis/:emojiId
   * Rename custom emoji
   */
  app.patch('/:id/emojis/:emojiId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId, emojiId } = request.params as { id: string; emojiId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.ADMINISTRATOR)) {
      return reply.status(403).send({ error: 'Administrator permission required' });
    }

    const { name } = request.body as { name: string };
    if (!name) return reply.status(400).send({ error: 'Emoji name is required' });

    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    const [updatedEmoji] = await db
      .update(beaconEmojis)
      .set({ name: cleanName })
      .where(and(eq(beaconEmojis.id, emojiId), eq(beaconEmojis.beaconId, beaconId)))
      .returning();

    return reply.send({ emoji: updatedEmoji });
  });

  /**
   * DELETE /api/v1/beacons/:id/emojis/:emojiId
   * Delete custom emoji
   */
  app.delete('/:id/emojis/:emojiId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId, emojiId } = request.params as { id: string; emojiId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.ADMINISTRATOR)) {
      return reply.status(403).send({ error: 'Administrator permission required' });
    }

    await db
      .delete(beaconEmojis)
      .where(and(eq(beaconEmojis.id, emojiId), eq(beaconEmojis.beaconId, beaconId)));

    return reply.send({ message: 'Emoji removed' });
  });
};
