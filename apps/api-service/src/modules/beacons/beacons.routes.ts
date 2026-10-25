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
  beaconTemplates,
  type TemplateSnapshot,
} from '@subspace/database';
import {
  PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  hasPermission,
  TIMEOUT_DURATIONS,
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
import { isQuarantined, QUARANTINED } from '../../lib/quarantine.js';
import { postWelcome, setUpSystemChannel } from '../../lib/system-messages.js';
import { BUILTIN_TEMPLATES, applyTemplate } from '../../lib/templates.js';
import { audit, diff } from '../../lib/audit.js';

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

    // Start from a built-in template, or a member's template by its code.
    let snapshot: TemplateSnapshot | null = null;
    if (typeof body?.template === 'string') {
      snapshot = BUILTIN_TEMPLATES[body.template] ?? null;
      if (!snapshot) return reply.status(400).send({ error: 'Unknown template' });
    } else if (typeof body?.templateCode === 'string') {
      const [tpl] = await db.select().from(beaconTemplates).where(eq(beaconTemplates.code, body.templateCode)).limit(1);
      if (!tpl) return reply.status(404).send({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' });
      snapshot = tpl.snapshot;
      await db.update(beaconTemplates).set({ usageCount: tpl.usageCount + 1 }).where(eq(beaconTemplates.code, tpl.code));
    }

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
        joinMethod: 'owner',
        clearanceIds: [],
      })
      .returning();

    if (snapshot) {
      await applyTemplate(db, newBeacon.id, snapshot);
    } else {
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
    }
    await setUpSystemChannel(app, db, newBeacon.id, token.transmitterId);
    const [created] = await db.select().from(beacons).where(eq(beacons.id, newBeacon.id)).limit(1);

    return reply.status(201).send({
      message: 'Beacon established successfully',
      beacon: created ?? newBeacon,
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

    // Every setting members see (engagement, tags, verification) comes with the list.
    const rows = await db
      .select({ beacon: beacons })
      .from(beaconMembers)
      .innerJoin(beacons, eq(beaconMembers.beaconId, beacons.id))
      .where(eq(beaconMembers.transmitterId, token.transmitterId));

    return reply.send({ beacons: rows.map((r: any) => r.beacon) });
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

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_BEACON)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_BEACON clearance' });
    }

    const body = request.body as any;
    const updates: Record<string, any> = { updatedAt: new Date() };
    const bad = (error: string) => reply.status(400).send({ error, code: 'INVALID_SETTING' });

    // A relay setting must name a relay of the right kind in this beacon (or null to clear it).
    const relayOf = async (id: unknown, type: string) => {
      if (id === null) return true;
      if (typeof id !== 'string') return false;
      const [r] = await db.select({ id: relays.id }).from(relays).where(and(eq(relays.id, id), eq(relays.beaconId, beaconId), eq(relays.type, type))).limit(1);
      return !!r;
    };
    for (const [key, type] of [['systemChannelId', 'text'], ['afkChannelId', 'comm_link'], ['widgetChannelId', 'text']] as const) {
      if (body[key] === undefined) continue;
      if (!(await relayOf(body[key], type))) return bad(`${key} must be a ${type === 'text' ? 'text' : 'comm-link'} relay in this beacon`);
      updates[key] = body[key];
    }
    for (const key of ['welcomeMessages', 'welcomeWave', 'setupTips', 'widgetEnabled']) {
      if (body[key] !== undefined) updates[key] = Boolean(body[key]);
    }
    if (body.defaultNotifications !== undefined) {
      if (![null, 'all', 'mentions'].includes(body.defaultNotifications)) return bad('defaultNotifications must be all, mentions or null');
      updates.defaultNotifications = body.defaultNotifications;
    }
    if (body.afkTimeout !== undefined) {
      if (![60, 300, 900, 1800, 3600].includes(body.afkTimeout)) return bad('afkTimeout must be 60, 300, 900, 1800 or 3600 seconds');
      updates.afkTimeout = body.afkTimeout;
    }
    if (body.verificationLevel !== undefined) {
      if (!['none', 'low', 'medium', 'high', 'highest'].includes(body.verificationLevel)) return bad('Unknown verificationLevel');
      updates.verificationLevel = body.verificationLevel;
    }
    if (body.tag !== undefined) {
      if (body.tag !== null && !/^[A-Za-z0-9]{2,4}$/.test(body.tag)) return bad('A tag is 2 to 4 letters or digits');
      updates.tag = body.tag ? body.tag.toUpperCase() : null;
    }
    if (body.tagBadge !== undefined) {
      if (body.tagBadge !== null && (typeof body.tagBadge !== 'string' || [...body.tagBadge].length > 8)) return bad('tagBadge must be one emoji');
      updates.tagBadge = body.tagBadge;
    }
    for (const key of ['invitesPausedUntil', 'dmsPausedUntil']) {
      if (body[key] === undefined) continue;
      const until = body[key] === null ? null : new Date(body[key]);
      if (until && (Number.isNaN(until.getTime()) || until.getTime() > Date.now() + 24 * 3600_000 + 60_000)) return bad(`${key} must be within the next 24 hours`);
      updates[key] = until;
    }

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

    const [before] = await db.select().from(beacons).where(eq(beacons.id, beaconId)).limit(1);
    const [updatedBeacon] = await db
      .update(beacons)
      .set(updates)
      .where(eq(beacons.id, beaconId))
      .returning();

    await publishGatewayEvent(app, 'BEACON_UPDATE', { beacon: updatedBeacon }, { beaconId });
    const changes = diff(before ?? {}, updatedBeacon, Object.keys(updates).filter((k) => k !== 'updatedAt'));
    if (changes.length) await audit(db, { beaconId, actorId: token.transmitterId, action: 'beacon_update', targetType: 'beacon', targetId: beaconId, targetName: updatedBeacon.name, changes });

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

    // Security Actions: admins can pause joining for up to a day.
    if (beacon.invitesPausedUntil && new Date(beacon.invitesPausedUntil) > new Date()) {
      return reply.status(403).send({ error: 'Invites to this beacon are paused right now', code: 'INVITES_PAUSED' });
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
    if (await isQuarantined(db, token.transmitterId)) return reply.status(403).send(QUARANTINED);

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
        joinMethod: 'discovery',
      })
      .returning();

    await publishGatewayEvent(app, 'MEMBER_ADD', { beaconId, member: await buildMember(db, (app as any).redis, beaconId, newMember.transmitterId) }, { beaconId });
    await publishSessionRefresh(app, await resolveBeaconAudience(db, beaconId));
    await postWelcome(app, db, beaconId, token.transmitterId);

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
   * PUT /api/v1/beacons/:id/members/:targetId/timeout   { seconds }   (0 lifts it)
   * Discord's timeout: the member keeps reading but cannot send, react or join voice.
   */
  app.put('/:id/members/:targetId/timeout', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { id: beaconId, targetId } = request.params as { id: string; targetId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const seconds = Number((request.body as any)?.seconds);
    if (seconds !== 0 && !(TIMEOUT_DURATIONS as readonly number[]).includes(seconds)) {
      return reply.status(400).send({ error: `seconds must be 0 or one of ${TIMEOUT_DURATIONS.join(', ')}` });
    }
    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MODERATE_MEMBERS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MODERATE_MEMBERS clearance' });
    }
    if (!(await assertCanModerateTarget(db, actorContext, targetId, reply))) return;

    const timeoutUntil = seconds ? new Date(Date.now() + seconds * 1000) : null;
    const [updated] = await db
      .update(beaconMembers)
      .set({ timeoutUntil })
      .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, targetId)))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Member not found' });
    await publishGatewayEvent(app, 'MEMBER_UPDATE', { beaconId, member: await buildMember(db, (app as any).redis, beaconId, targetId) }, { beaconId });
    await publishSessionRefresh(app, [targetId]);
    return reply.send({ timeoutUntil });
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
   * GET /api/v1/beacons/:id/members/@me/privacy
   * The caller's Privacy Settings for this beacon (only they see these).
   */
  app.get('/:id/members/@me/privacy', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: beaconId } = request.params as { id: string };
    const [member] = await db
      .select({ allowDms: beaconMembers.allowDms })
      .from(beaconMembers)
      .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, token.transmitterId)))
      .limit(1);
    if (!member) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    return reply.send({ privacy: member });
  });

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
            allowDms: { type: 'boolean' },
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
      if (body.allowDms !== undefined) updates.allowDms = body.allowDms;

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
