import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, asc, relays, beacons } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';

export const relayRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/beacons/:beaconId/relays
   * List all relays in a beacon sorted by position
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { beaconId } = request.params as { beaconId: string };
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

    return reply.send({ relays: beaconRelays });
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
    const { name, type, topic, position, parentId, isUnhideable } = body || {};

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
      })
      .returning();

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

    const [updated] = await db
      .update(relays)
      .set(updates)
      .where(eq(relays.id, relayId))
      .returning();

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

    await db.delete(relays).where(eq(relays.id, relayId));

    return reply.send({ message: 'Relay decommissioned successfully' });
  });
};
