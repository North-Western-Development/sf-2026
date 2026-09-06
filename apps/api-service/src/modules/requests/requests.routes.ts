import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, desc, transmissionRequests, transmitters } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';

export const requestRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/requests
   * List pending transmission requests for the caller
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const requests = await db
      .select({
        id: transmissionRequests.id,
        senderId: transmissionRequests.senderId,
        recipientId: transmissionRequests.recipientId,
        mutualBeaconId: transmissionRequests.mutualBeaconId,
        initialTransmission: transmissionRequests.initialTransmission,
        status: transmissionRequests.status,
        createdAt: transmissionRequests.createdAt,
        expiresAt: transmissionRequests.expiresAt,
        senderName: transmitters.displayName,
        senderUsername: transmitters.username,
        senderAvatar: transmitters.avatarUrl,
      })
      .from(transmissionRequests)
      .innerJoin(transmitters, eq(transmissionRequests.senderId, transmitters.id))
      .where(
        and(
          eq(transmissionRequests.recipientId, token.transmitterId),
          eq(transmissionRequests.status, 'pending')
        )
      )
      .orderBy(desc(transmissionRequests.createdAt));

    return reply.send({ requests });
  });

  /**
   * POST /api/v1/requests/:id/accept
   * Accept transmission request, opening two-way direct communication
   */
  app.post('/:id/accept', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: reqId } = request.params as { id: string };

    const [req] = await db
      .select()
      .from(transmissionRequests)
      .where(eq(transmissionRequests.id, reqId))
      .limit(1);

    if (!req) return reply.status(404).send({ error: 'Transmission request not found' });

    if (req.recipientId !== token.transmitterId) {
      return reply.status(403).send({ error: 'Only recipient can accept this transmission request' });
    }

    const [updated] = await db
      .update(transmissionRequests)
      .set({ status: 'accepted' })
      .where(eq(transmissionRequests.id, reqId))
      .returning();

    return reply.send({
      message: 'Transmission request accepted. Two-way link unlocked.',
      request: updated,
    });
  });

  /**
   * POST /api/v1/requests/:id/decline
   * Decline transmission request
   */
  app.post('/:id/decline', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: reqId } = request.params as { id: string };

    const [req] = await db
      .select()
      .from(transmissionRequests)
      .where(eq(transmissionRequests.id, reqId))
      .limit(1);

    if (!req) return reply.status(404).send({ error: 'Transmission request not found' });

    if (req.recipientId !== token.transmitterId) {
      return reply.status(403).send({ error: 'Only recipient can decline this transmission request' });
    }

    const [updated] = await db
      .update(transmissionRequests)
      .set({ status: 'declined' })
      .where(eq(transmissionRequests.id, reqId))
      .returning();

    return reply.send({
      message: 'Transmission request declined',
      request: updated,
    });
  });
};
