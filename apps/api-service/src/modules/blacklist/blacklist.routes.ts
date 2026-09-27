import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, or, signalBlacklist, affiliations } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishSessionRefresh, publishGatewayEvent } from '../../lib/events.js';

export const blacklistRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/blacklist
   * Block a transmitter, transmission, or beacon
   */
  app.post('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const body = request.body as any;
    const { targetId, targetType } = body || {};

    if (!targetId || !targetType) {
      return reply.status(400).send({ error: 'targetId and targetType (transmitter | transmission | beacon) required' });
    }

    if (!['transmitter', 'transmission', 'beacon'].includes(targetType)) {
      return reply.status(400).send({ error: 'Invalid targetType. Must be transmitter, transmission, or beacon' });
    }

    if (targetType === 'transmitter' && targetId === token.transmitterId) {
      return reply.status(400).send({ error: 'Cannot blacklist self' });
    }

    const [existing] = await db
      .select()
      .from(signalBlacklist)
      .where(
        and(
          eq(signalBlacklist.transmitterId, token.transmitterId),
          eq(signalBlacklist.targetId, targetId),
          eq(signalBlacklist.targetType, targetType)
        )
      )
      .limit(1);

    if (existing) {
      return reply.status(409).send({ error: 'Entity is already blacklisted' });
    }

    const [blocked] = await db
      .insert(signalBlacklist)
      .values({
        transmitterId: token.transmitterId,
        targetId,
        targetType,
      })
      .returning();

    if (targetType === 'transmitter') {
      // Blocking removes any friendship and pending affiliation requests between the two.
      const removed = await db
        .delete(affiliations)
        .where(
          or(
            and(eq(affiliations.transmitterId, token.transmitterId), eq(affiliations.targetId, targetId)),
            and(eq(affiliations.transmitterId, targetId), eq(affiliations.targetId, token.transmitterId))
          )
        )
        .returning();
      if (removed.length > 0) {
        await publishSessionRefresh(app, [token.transmitterId, targetId]);
        await publishGatewayEvent(app, 'RELATIONSHIP_REMOVE', { affiliationId: removed[0].id }, { transmitterIds: [token.transmitterId, targetId] });
      }
    }

    return reply.status(201).send({
      message: 'Target filtered and blacklisted',
      blacklisted: blocked,
    });
  });

  /**
   * GET /api/v1/blacklist
   * List all entities on the caller's signal blacklist
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const list = await db
      .select()
      .from(signalBlacklist)
      .where(eq(signalBlacklist.transmitterId, token.transmitterId));

    return reply.send({ blacklist: list });
  });

  /**
   * DELETE /api/v1/blacklist/:targetId
   * Remove target from blacklist
   */
  app.delete('/:targetId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { targetId } = request.params as { targetId: string };

    await db
      .delete(signalBlacklist)
      .where(
        and(
          eq(signalBlacklist.transmitterId, token.transmitterId),
          eq(signalBlacklist.targetId, targetId)
        )
      );

    return reply.send({ message: 'Target unblocked and restored' });
  });
};
