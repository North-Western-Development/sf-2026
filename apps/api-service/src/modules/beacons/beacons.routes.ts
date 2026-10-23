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
  beaconBans,
  relays,
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
  resolveBeaconTargetContext,
  assertCanModerateTarget,
} from '../../middleware/hierarchy.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';
import { validateMediaUrl } from '../../lib/media.js';
import { buildMember, buildMembers } from '../../lib/members.js';

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
    if (name.trim().length > 100) {
      return reply.status(400).send({ error: 'Beacon name cannot exceed 100 characters' });
    }
    if (iconUrl && !(await validateMediaUrl(db, token.transmitterId, iconUrl, ['beacon_icon']))) {
      return reply.status(400).send({ error: 'Invalid media URL for iconUrl', code: 'INVALID_MEDIA_URL' });
    }
    if (bannerUrl && !(await validateMediaUrl(db, token.transmitterId, bannerUrl, ['beacon_banner']))) {
      return reply.status(400).send({ error: 'Invalid media URL for bannerUrl', code: 'INVALID_MEDIA_URL' });
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

    // Discord-style starter layout: a text band with #general and a Comm-Link band with General.
    const [textBand] = await db
      .insert(relays)
      .values({ beaconId: newBeacon.id, name: 'Text Relays', type: 'category', position: 0 })
      .returning();
    const [voiceBand] = await db
      .insert(relays)
      .values({ beaconId: newBeacon.id, name: 'Comm-Links', type: 'category', position: 1 })
      .returning();
    await db.insert(relays).values([
      { beaconId: newBeacon.id, parentId: textBand.id, name: 'general', type: 'text', position: 0 },
      { beaconId: newBeacon.id, parentId: voiceBand.id, name: 'General', type: 'comm_link', position: 0 },
    ]);

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

    // Private beacons are only visible to their members; same 404 so ids cannot be probed.
    if (!beacon.isDiscoverable) {
      const token = extractAuthToken(request)!;
      const [membership] = await db
        .select({ id: beaconMembers.transmitterId })
        .from(beaconMembers)
        .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, token.transmitterId)))
        .limit(1);
      if (!membership) return reply.status(404).send({ error: 'Beacon not found' });
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

    if (updates.iconUrl !== undefined && !(await validateMediaUrl(db, token.transmitterId, updates.iconUrl, ['beacon_icon']))) {
      return reply.status(400).send({ error: 'Invalid media URL for iconUrl', code: 'INVALID_MEDIA_URL' });
    }
    if (updates.bannerUrl !== undefined && !(await validateMediaUrl(db, token.transmitterId, updates.bannerUrl, ['beacon_banner']))) {
      return reply.status(400).send({ error: 'Invalid media URL for bannerUrl', code: 'INVALID_MEDIA_URL' });
    }

    const [updatedBeacon] = await db
      .update(beacons)
      .set(updates)
      .where(eq(beacons.id, beaconId))
      .returning();

    await publishGatewayEvent(app, 'BEACON_UPDATE', { beacon: updatedBeacon }, { beaconId });

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

    const audience = await resolveBeaconAudience(db, beaconId);

    await db.delete(beacons).where(eq(beacons.id, beaconId));

    await publishGatewayEvent(app, 'BEACON_DELETE', { id: beaconId, unavailable: false }, { transmitterIds: audience });

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

    if (!beacon.isDiscoverable) {
      return reply.status(403).send({
        error: 'This Beacon is not discoverable; join via an invite instead',
        code: 'BEACON_NOT_DISCOVERABLE',
      });
    }

    const [ban] = await db
      .select()
      .from(beaconBans)
      .where(and(eq(beaconBans.beaconId, beaconId), eq(beaconBans.transmitterId, token.transmitterId)))
      .limit(1);
    if (ban) {
      return reply.status(403).send({ error: 'Transmitter is banned from this Beacon', code: 'BANNED' });
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

    await publishGatewayEvent(app, 'MEMBER_ADD', { beaconId, member: await buildMember(db, (app as any).redis, beaconId, newMember.transmitterId) }, { beaconId });
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
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    // Only members (or the owner) may list members; outsiders get 404 so existence isn't leaked.
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return reply.status(404).send({ error: 'Beacon not found' });

    return reply.send({ members: await buildMembers(db, (app as any).redis, beaconId) });
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

    const audience = await resolveBeaconAudience(db, beaconId);
    await publishGatewayEvent(app, 'MEMBER_REMOVE', { beaconId, transmitterId: targetId }, { transmitterIds: [targetId, ...audience] });
    await publishSessionRefresh(app, [targetId, ...audience]);

    return reply.send({ message: 'Target transmitter expelled from Beacon' });
  });

  /**
   * GET /api/v1/beacons/:id/emojis
   * List custom emojis for a beacon
   */
  app.get('/:id/emojis', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    if (!(await resolveBeaconActorContext(db, token.transmitterId, beaconId))) {
      return reply.status(404).send({ error: 'Beacon not found' });
    }

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

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_GLYPHS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_GLYPHS clearance' });
    }

    const { name, url } = request.body as { name: string; url: string };
    if (!name || !url) {
      return reply.status(400).send({ error: 'Emoji name and URL are required' });
    }

    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (!cleanName) {
      return reply.status(400).send({ error: 'Emoji name must be alphanumeric or underscores' });
    }

    if (!(await validateMediaUrl(db, token.transmitterId, url.trim(), ['glyph']))) {
      return reply.status(400).send({ error: 'Glyph url must be a completed media upload you own', code: 'INVALID_MEDIA_URL' });
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

    await publishGatewayEvent(app, 'GLYPHS_UPDATE', { beaconId }, { beaconId });

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

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_GLYPHS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_GLYPHS clearance' });
    }

    const { name } = request.body as { name: string };
    if (!name) return reply.status(400).send({ error: 'Emoji name is required' });

    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    const [updatedEmoji] = await db
      .update(beaconEmojis)
      .set({ name: cleanName })
      .where(and(eq(beaconEmojis.id, emojiId), eq(beaconEmojis.beaconId, beaconId)))
      .returning();

    if (!updatedEmoji) return reply.status(404).send({ error: 'Glyph not found' });

    await publishGatewayEvent(app, 'GLYPHS_UPDATE', { beaconId }, { beaconId });

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

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_GLYPHS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_GLYPHS clearance' });
    }

    await db
      .delete(beaconEmojis)
      .where(and(eq(beaconEmojis.id, emojiId), eq(beaconEmojis.beaconId, beaconId)));

    await publishGatewayEvent(app, 'GLYPHS_UPDATE', { beaconId }, { beaconId });

    return reply.send({ message: 'Emoji removed' });
  });

  //
  // Bans (section 6)
  //

  /**
   * GET /api/v1/beacons/:id/bans
   */
  app.get('/:id/bans', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: beaconId } = request.params as { id: string };
    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.BAN_MEMBERS)) {
      return reply.status(403).send({ error: 'Transmitter lacks BAN_MEMBERS clearance' });
    }

    const rows = await db.select().from(beaconBans).where(eq(beaconBans.beaconId, beaconId));
    return reply.send({ bans: rows });
  });

  /**
   * PUT /api/v1/beacons/:id/bans/:userId
   */
  app.put(
    '/:id/bans/:userId',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            reason: { type: 'string' },
            deleteMessageSeconds: { type: 'number', minimum: 0, maximum: 604800 },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { id: beaconId, userId: targetId } = request.params as { id: string; userId: string };
      const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
      if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
      if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.BAN_MEMBERS)) {
        return reply.status(403).send({ error: 'Transmitter lacks BAN_MEMBERS clearance' });
      }

      const canModerate = await assertCanModerateTarget(db, actorContext, targetId, reply);
      if (!canModerate) return;

      const { reason } = (request.body as any) || {};

      const audience = await resolveBeaconAudience(db, beaconId);

      await db
        .delete(beaconMembers)
        .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, targetId)));

      await db
        .insert(beaconBans)
        .values({ beaconId, transmitterId: targetId, reason: reason || null, bannedBy: token.transmitterId })
        .onConflictDoUpdate({
          target: [beaconBans.beaconId, beaconBans.transmitterId],
          set: { reason: reason || null, bannedBy: token.transmitterId, createdAt: new Date() },
        });

      await publishGatewayEvent(app, 'MEMBER_REMOVE', { beaconId, transmitterId: targetId }, { transmitterIds: [targetId, ...audience] });
      await publishSessionRefresh(app, [targetId, ...audience]);

      return reply.send({ message: 'Transmitter banned from Beacon' });
    }
  );

  /**
   * DELETE /api/v1/beacons/:id/bans/:userId
   */
  app.delete('/:id/bans/:userId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: beaconId, userId: targetId } = request.params as { id: string; userId: string };
    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.BAN_MEMBERS)) {
      return reply.status(403).send({ error: 'Transmitter lacks BAN_MEMBERS clearance' });
    }

    await db
      .delete(beaconBans)
      .where(and(eq(beaconBans.beaconId, beaconId), eq(beaconBans.transmitterId, targetId)));

    return reply.send({ message: 'Ban lifted' });
  });

  //
  // Members (section 6 & 9: nickname, per-beacon profile, clearances)
  //

  /**
   * PATCH /api/v1/beacons/:id/members/@me
   */
  app.patch(
    '/:id/members/@me',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nickname: { type: ['string', 'null'], maxLength: 32 },
            avatarUrl: { type: ['string', 'null'] },
            bannerUrl: { type: ['string', 'null'] },
            bio: { type: ['string', 'null'], maxLength: 190 },
            pronouns: { type: ['string', 'null'], maxLength: 40 },
            themePrimary: { type: ['string', 'null'] },
            themeAccent: { type: ['string', 'null'] },
            displayNameStyle: { type: ['object', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { id: beaconId } = request.params as { id: string };
      const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
      if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });

      const body = (request.body as any) || {};
      const updates: Record<string, any> = {};

      if (body.nickname !== undefined) {
        if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.CHANGE_NICKNAME)) {
          return reply.status(403).send({ error: 'Transmitter lacks CHANGE_NICKNAME clearance' });
        }
        updates.nickname = body.nickname === null ? null : body.nickname.trim();
      }
      if (body.avatarUrl !== undefined) {
        if (!(await validateMediaUrl(db, token.transmitterId, body.avatarUrl, ['avatar']))) {
          return reply.status(400).send({ error: 'Invalid media URL for avatarUrl', code: 'INVALID_MEDIA_URL' });
        }
        updates.avatarUrl = body.avatarUrl;
      }
      if (body.bannerUrl !== undefined) {
        if (!(await validateMediaUrl(db, token.transmitterId, body.bannerUrl, ['banner']))) {
          return reply.status(400).send({ error: 'Invalid media URL for bannerUrl', code: 'INVALID_MEDIA_URL' });
        }
        updates.bannerUrl = body.bannerUrl;
      }
      if (body.bio !== undefined) updates.bio = body.bio;
      if (body.pronouns !== undefined) updates.pronouns = body.pronouns;
      if (body.themePrimary !== undefined) updates.themePrimary = body.themePrimary;
      if (body.themeAccent !== undefined) updates.themeAccent = body.themeAccent;
      if (body.displayNameStyle !== undefined) updates.displayNameStyle = body.displayNameStyle;

      if (Object.keys(updates).length === 0) {
        return reply.send({ member: actorContext.member });
      }

      const [updated] = await db
        .update(beaconMembers)
        .set(updates)
        .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, token.transmitterId)))
        .returning();

      await publishGatewayEvent(app, 'MEMBER_UPDATE', { beaconId, member: await buildMember(db, (app as any).redis, beaconId, updated.transmitterId) }, { beaconId });

      return reply.send({ member: updated });
    }
  );

  /**
   * PATCH /api/v1/beacons/:id/members/:userId
   */
  app.patch(
    '/:id/members/:userId',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nickname: { type: ['string', 'null'], maxLength: 32 },
            clearanceIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { id: beaconId, userId: targetId } = request.params as { id: string; userId: string };
      const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
      if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });

      const body = (request.body as any) || {};
      const updates: Record<string, any> = {};

      if (body.nickname !== undefined) {
        if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_NICKNAMES)) {
          return reply.status(403).send({ error: 'Transmitter lacks MANAGE_NICKNAMES clearance' });
        }
        const canModerate = await assertCanModerateTarget(db, actorContext, targetId, reply);
        if (!canModerate) return;
        updates.nickname = body.nickname === null ? null : body.nickname.trim();
      }

      if (body.clearanceIds !== undefined) {
        if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_CLEARANCES)) {
          return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance' });
        }
        const targetContext = await resolveBeaconTargetContext(db, targetId, beaconId);
        if (!targetContext) return reply.status(404).send({ error: 'Target member not found in Beacon' });
        if (targetContext.isOwner) {
          return reply.status(403).send({ error: 'Cannot modify clearances for the Beacon owner', code: 'FORBIDDEN_HIERARCHY' });
        }
        if (!actorContext.isOwner && targetContext.highestRank >= actorContext.highestRank) {
          return reply.status(403).send({
            error: 'Cannot modify clearances for a member with equal or higher rank',
            code: 'FORBIDDEN_HIERARCHY',
          });
        }

        const requestedIds: string[] = body.clearanceIds;
        if (!actorContext.isOwner) {
          const allClearances = await db.select().from(clearances).where(eq(clearances.beaconId, beaconId));
          const clearanceMap = new Map(allClearances.map((c: any) => [c.id, c]));
          for (const cid of requestedIds) {
            const c: any = clearanceMap.get(cid);
            if (!c) return reply.status(400).send({ error: `Unknown clearance id ${cid}` });
            if (c.position >= actorContext.highestRank) {
              return reply.status(403).send({
                error: 'Cannot assign a clearance at or above your own highest clearance',
                code: 'FORBIDDEN_HIERARCHY',
              });
            }
          }
        }
        updates.clearanceIds = requestedIds;
      }

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'No recognized fields to update' });
      }

      const [updated] = await db
        .update(beaconMembers)
        .set(updates)
        .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, targetId)))
        .returning();

      if (!updated) return reply.status(404).send({ error: 'Target member not found in Beacon' });

      await publishGatewayEvent(app, 'MEMBER_UPDATE', { beaconId, member: await buildMember(db, (app as any).redis, beaconId, updated.transmitterId) }, { beaconId });

      return reply.send({ member: updated });
    }
  );
};
