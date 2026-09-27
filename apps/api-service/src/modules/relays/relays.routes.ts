import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  asc,
  relays,
  beacons,
  transmitterRelayPreferences,
  computeRelayPermissions,
  resolveRelayAudience,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
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

    const mappedRelays = await Promise.all(
      beaconRelays.map(async (relay: any) => ({
        ...relay,
        isHidden: hiddenRelayIds.has(relay.id),
        myPermissions: (await computeRelayPermissions(db, token.transmitterId, relay.id)).toString(),
      }))
    );

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
   * Create a new Relay in a Beacon (requires MANAGE_RELAYS or owner)
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

    if (!actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_RELAYS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_RELAYS clearance' });
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
    if (body.parentId !== undefined) updates.parentId = body.parentId;
    if (body.permissionsSynced !== undefined) updates.permissionsSynced = Boolean(body.permissionsSynced);

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

