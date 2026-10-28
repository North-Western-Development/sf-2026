import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  asc,
  relays,
  relayOverwrites,
  beacons,
  transmitterRelayPreferences,
  computeRelayPermissions,
  resolveRelayAudience,
} from '@subspace/database';
import { PERMISSIONS, hasPermission, SLOWMODE_CHOICES } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';

export const relayRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/beacons/:beaconId/relays
   * List relays in a beacon.
   * Query options:
   * ?filter=visible (default) -> returns unhidden relays + all unhideable relays
   * ?filter=all -> returns all relays regardless of preference
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { beaconId } = request.params as { beaconId: string };
    const query = request.query as any;
    const filterMode = query.filter === 'all' ? 'all' : 'visible';

    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    const beaconRelays = await db
      .select()
      .from(relays)
      .where(eq(relays.beaconId, beaconId))
      .orderBy(asc(relays.position));

    // Fetch user preferences for relays in this beacon
    const userPrefs = await db
      .select()
      .from(transmitterRelayPreferences)
      .where(eq(transmitterRelayPreferences.transmitterId, token.transmitterId));

    const hiddenRelayIds = new Set(
      userPrefs.filter((p: any) => p.isHidden).map((p: any) => p.relayId)
    );

    const withPerms = await Promise.all(
      beaconRelays.map(async (relay: any) => {
        const perms = await computeRelayPermissions(db, token.transmitterId, relay.id);
        return {
          ...relay,
          isHidden: hiddenRelayIds.has(relay.id),
          myPermissions: perms.toString(),
          canView: hasPermission(perms, PERMISSIONS.VIEW_RELAY),
        };
      })
    );
    // Relays the viewer cannot see are omitted entirely; a frequency band stays visible when
    // the viewer can see it or any relay inside it.
    const visibleChildParents = new Set(withPerms.filter((r: any) => r.canView && r.parentId).map((r: any) => r.parentId));
    const mappedRelays = withPerms
      .filter((r: any) => r.canView || (r.type === 'category' && visibleChildParents.has(r.id)))
      .map(({ canView: _canView, ...r }: any) => r);

    if (filterMode === 'all') {
      return reply.send({ relays: mappedRelays, filter: 'all' });
    }

    // visible: exclude hidden relays UNLESS isUnhideable is true
    const visibleRelays = mappedRelays.filter(
      (relay: any) => !relay.isHidden || relay.isUnhideable
    );

    return reply.send({ relays: visibleRelays, filter: 'visible' });
  });

  /**
   * POST /api/v1/beacons/:beaconId/relays
   * Create a new Relay in a Beacon (requires CREATE_RELAYS or MANAGE_RELAYS, or owner)
   */
  app.post('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { beaconId } = request.params as { beaconId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.CREATE_RELAYS) && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_RELAYS)) {
      return reply.status(403).send({ error: 'Transmitter lacks CREATE_RELAYS clearance' });
    }

    const body = request.body as any;
    const { name, type, topic, position, parentId, isUnhideable, permissionsSynced } = body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.status(400).send({ error: 'Relay name is required' });
    }

    const [newRelay] = await db
      .insert(relays)
      .values({
        beaconId,
        name: name.trim().toLowerCase().replace(/\s+/g, '-'),
        type: type || 'text',
        topic: topic || null,
        position: Number(position) || 0,
        parentId: parentId || null,
        isUnhideable: Boolean(isUnhideable),
        permissionsSynced: permissionsSynced === undefined ? true : Boolean(permissionsSynced),
        // Announcement relays are text relays whose posts can be published to their followers.
        isAnnouncement: (type || 'text') === 'text' && body?.isAnnouncement === true,
      })
      .returning();

    await publishGatewayEvent(app, 'RELAY_CREATE', { beaconId, relay: newRelay }, { relayId: newRelay.id });

    return reply.status(201).send({
      message: 'Relay established successfully',
      relay: newRelay,
    });
  });

  /**
   * PATCH /api/v1/relays/:relayId
   * Update relay properties (name, topic, position)
   */
  app.patch('/:relayId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { relayId } = request.params as { relayId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [existingRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!existingRelay) {
      return reply.status(404).send({ error: 'Relay not found' });
    }

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, existingRelay.beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_RELAYS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_RELAYS clearance' });
    }

    const body = request.body as any;
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (body.name !== undefined) updates.name = body.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (body.topic !== undefined) updates.topic = body.topic;
    if (body.position !== undefined) updates.position = Number(body.position);
    if (body.isUnhideable !== undefined) updates.isUnhideable = Boolean(body.isUnhideable);
    if (body.slowmodeSeconds !== undefined) {
      if (!(SLOWMODE_CHOICES as readonly number[]).includes(Number(body.slowmodeSeconds))) return reply.status(400).send({ error: 'Pick one of the slowmode choices', code: 'INVALID_SLOWMODE' });
      updates.slowmodeSeconds = Number(body.slowmodeSeconds);
    }
    if (body.parentId !== undefined) {
      // Only into a band of the same beacon (or out of any band, with null).
      if (body.parentId !== null) {
        const [band] = await db.select().from(relays).where(eq(relays.id, body.parentId)).limit(1);
        if (!band || band.beaconId !== existingRelay.beaconId || band.type !== 'category' || existingRelay.type === 'category') {
          return reply.status(400).send({ error: 'Move it into a band of this beacon', code: 'INVALID_PARENT' });
        }
      }
      updates.parentId = body.parentId;
    }
    if (body.permissionsSynced !== undefined) updates.permissionsSynced = Boolean(body.permissionsSynced);
    // Synced with its band: the band's overwrites apply, so its own are dropped (as Discord does).
    if (updates.permissionsSynced === true && (updates.parentId ?? existingRelay.parentId)) {
      await db.delete(relayOverwrites).where(eq(relayOverwrites.relayId, relayId));
    }
    if (body.isAnnouncement !== undefined) {
      if (existingRelay.type !== 'text') return reply.status(400).send({ error: 'Only text relays can be announcement relays', code: 'NOT_A_TEXT_RELAY' });
      updates.isAnnouncement = body.isAnnouncement === true;
    }
    if (body.isE2ee !== undefined) {
      if (existingRelay.type !== 'comm_link') return reply.status(400).send({ error: 'Only Comm-Links carry voice and video', code: 'NOT_A_COMM_LINK' });
      updates.isE2ee = body.isE2ee === true;
    }

    const beforeAudience = await resolveRelayAudience(db, relayId);

    const [updated] = await db
      .update(relays)
      .set(updates)
      .where(eq(relays.id, relayId))
      .returning();

    const afterAudience = await resolveRelayAudience(db, relayId);
    const combinedAudience = [...new Set([...beforeAudience, ...afterAudience])];

    await publishGatewayEvent(
      app,
      'RELAY_UPDATE',
      { beaconId: existingRelay.beaconId, relay: updated },
      { transmitterIds: combinedAudience }
    );

    return reply.send({
      message: 'Relay parameters updated',
      relay: updated,
    });
  });

  /**
   * DELETE /api/v1/relays/:relayId
   * Delete Relay
   */
  app.delete('/:relayId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { relayId } = request.params as { relayId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [existingRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!existingRelay) {
      return reply.status(404).send({ error: 'Relay not found' });
    }

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, existingRelay.beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_RELAYS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_RELAYS clearance' });
    }

    const audience = await resolveRelayAudience(db, relayId);

    await db.delete(relays).where(eq(relays.id, relayId));

    await publishGatewayEvent(
      app,
      'RELAY_DELETE',
      { beaconId: existingRelay.beaconId, relayId },
      { transmitterIds: audience }
    );

    return reply.send({ message: 'Relay decommissioned successfully' });
  });

  /**
   * PATCH /api/v1/beacons/:beaconId/relays/:relayId/visibility
   * Toggle visibility of a relay for the authenticated transmitter.
   * INVARIANT: Relays with isUnhideable: true cannot be hidden.
   */
  app.patch('/:relayId/visibility', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { relayId } = request.params as { relayId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [existingRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!existingRelay) {
      return reply.status(404).send({ error: 'Relay not found' });
    }

    const body = request.body as any;
    const isHidden = Boolean(body?.isHidden);

    // INVARIANT: Unhideable relay cannot be hidden
    if (isHidden && existingRelay.isUnhideable) {
      return reply.status(400).send({
        error: 'Core Priority Relays cannot be hidden from view',
        code: 'RELAY_IS_UNHIDEABLE',
      });
    }

    // Upsert preference
    await db
      .insert(transmitterRelayPreferences)
      .values({
        transmitterId: token.transmitterId,
        relayId,
        isHidden,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [transmitterRelayPreferences.transmitterId, transmitterRelayPreferences.relayId],
        set: {
          isHidden,
          updatedAt: new Date(),
        },
      });

    return reply.send({
      message: 'Relay visibility preference updated',
      relayId,
      isHidden,
    });
  });
};

