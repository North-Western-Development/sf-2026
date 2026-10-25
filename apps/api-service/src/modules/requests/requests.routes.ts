import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, or, gt, desc, transmissionRequests, transmitters, pointToPointLinks, transmissions } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';
import { AUTHOR_FIELDS } from '../../lib/transmissions.js';
import { scheduleEmbeds } from '../../lib/embeds.js';

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
        isSpam: transmissionRequests.isSpam,
        createdAt: transmissionRequests.createdAt,
        expiresAt: transmissionRequests.expiresAt,
        senderName: transmitters.displayName,
        senderUsername: transmitters.username,
        senderDiscriminator: transmitters.discriminator,
        senderAvatar: transmitters.avatarUrl,
      })
      .from(transmissionRequests)
      .innerJoin(transmitters, eq(transmissionRequests.senderId, transmitters.id))
      .where(
        and(
          eq(transmissionRequests.recipientId, token.transmitterId),
          eq(transmissionRequests.status, 'pending'),
          gt(transmissionRequests.expiresAt, new Date()),
          // ?spam=true lists the Spam folder instead.
          eq(transmissionRequests.isSpam, (request.query as any)?.spam === 'true')
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
      return reply.status(404).send({ error: 'Transmission request not found' });
    }
    if (req.status !== 'pending') {
      return reply.status(409).send({ error: 'Transmission request already handled', code: 'REQUEST_HANDLED' });
    }
    if (new Date(req.expiresAt).getTime() <= Date.now()) {
      await db.update(transmissionRequests).set({ status: 'timed_out' }).where(eq(transmissionRequests.id, reqId));
      return reply.status(410).send({ error: 'Transmission request expired', code: 'REQUEST_EXPIRED' });
    }

    const [updated] = await db
      .update(transmissionRequests)
      .set({ status: 'accepted' })
      .where(eq(transmissionRequests.id, reqId))
      .returning();

    // Open (or reuse) the link and carry the introductory transmission into its history.
    let [link] = await db
      .select()
      .from(pointToPointLinks)
      .where(
        or(
          and(eq(pointToPointLinks.transmitter1Id, req.senderId), eq(pointToPointLinks.transmitter2Id, req.recipientId)),
          and(eq(pointToPointLinks.transmitter1Id, req.recipientId), eq(pointToPointLinks.transmitter2Id, req.senderId))
        )
      )
      .limit(1);
    if (!link) {
      [link] = await db.insert(pointToPointLinks).values({ transmitter1Id: req.senderId, transmitter2Id: req.recipientId }).returning();
    }
    const [intro] = await db
      .insert(transmissions)
      .values({ p2pLinkId: link.id, transmitterId: req.senderId, content: req.initialTransmission, createdAt: req.createdAt })
      .returning();
scheduleEmbeds(app, intro);

    const [author] = await db.select(AUTHOR_FIELDS).from(transmitters).where(eq(transmitters.id, req.senderId)).limit(1);

    await publishSessionRefresh(app, [req.senderId, req.recipientId]);
    await publishGatewayEvent(
      app,
      'DIRECT_TRANSMISSION_CREATE',
      { link_id: link.id, channelType: 'link', channelId: link.id, sender_id: req.senderId, recipient_id: req.recipientId, transmission: { ...intro, author: author ?? null } },
      { transmitterIds: [req.senderId, req.recipientId] }
    );

    return reply.send({
      message: 'Transmission request accepted. Two-way link unlocked.',
      request: updated,
      linkId: link.id,
    });
  });

  /**
   * POST /api/v1/requests/:id/decline
   * Decline transmission request
   */
  /**
   * POST /api/v1/requests/:id/not-spam — moves a request out of Spam into Requests.
   */
  app.post('/:id/not-spam', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { id } = request.params as { id: string };
    const [updated] = await db
      .update(transmissionRequests)
      .set({ isSpam: false })
      .where(and(eq(transmissionRequests.id, id), eq(transmissionRequests.recipientId, token.transmitterId)))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Request not found' });
    return reply.send({ request: updated });
  });

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
      return reply.status(404).send({ error: 'Transmission request not found' });
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
