import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, or, affiliations, transmitters, signalBlacklist } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishSessionRefresh, publishGatewayEvent } from '../../lib/events.js';
import { AUTHOR_FIELDS } from '../../lib/transmissions.js';

const MAX_GREETING_NOTE_LENGTH = 200;

export const affiliationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/affiliations/request
   * Send an affiliation (friend) request with an optional greeting note (up to 200 chars).
   * Accepts either { targetId } or { username, discriminator }.
   */
  app.post('/request', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const body = request.body as any;
    let { targetId, greetingNote, username, discriminator } = body || {};

    if (!targetId && username && discriminator) {
      const [byUsername] = await db
        .select()
        .from(transmitters)
        .where(and(eq(transmitters.username, username), eq(transmitters.discriminator, discriminator)))
        .limit(1);
      if (!byUsername) return reply.status(404).send({ error: 'Transmitter not found' });
      targetId = byUsername.id;
    }

    if (!targetId || typeof targetId !== 'string') {
      return reply.status(400).send({ error: 'targetId, or username+discriminator, required' });
    }

    if (targetId === token.transmitterId) {
      return reply.status(400).send({ error: 'Cannot affiliate with self' });
    }

    if (greetingNote && greetingNote.length > MAX_GREETING_NOTE_LENGTH) {
      return reply.status(400).send({
        error: `Greeting note exceeds maximum length of ${MAX_GREETING_NOTE_LENGTH} characters`,
        code: 'GREETING_NOTE_EXCEEDS_LENGTH',
      });
    }

    // Check blacklist
    const isBlocked = await db
      .select()
      .from(signalBlacklist)
      .where(
        or(
          and(
            eq(signalBlacklist.transmitterId, targetId),
            eq(signalBlacklist.targetId, token.transmitterId),
            eq(signalBlacklist.targetType, 'transmitter')
          ),
          and(
            eq(signalBlacklist.transmitterId, token.transmitterId),
            eq(signalBlacklist.targetId, targetId),
            eq(signalBlacklist.targetType, 'transmitter')
          )
        )
      )
      .limit(1);

    if (isBlocked.length > 0) {
      return reply.status(403).send({
        error: 'Communication blocked by signal filter',
        code: 'SIGNAL_BLOCKED',
      });
    }

    // Check existing affiliation or request
    const [existing] = await db
      .select()
      .from(affiliations)
      .where(
        or(
          and(eq(affiliations.transmitterId, token.transmitterId), eq(affiliations.targetId, targetId)),
          and(eq(affiliations.transmitterId, targetId), eq(affiliations.targetId, token.transmitterId))
        )
      )
      .limit(1);

    if (existing) {
      if (existing.status === 'accepted') {
        return reply.status(409).send({ error: 'Transmitters are already affiliated' });
      }
      if (existing.status === 'pending') {
        return reply.status(409).send({ error: 'An affiliation request is already pending' });
      }
    }

    const [newAffiliation] = await db
      .insert(affiliations)
      .values({
        transmitterId: token.transmitterId,
        targetId,
        status: 'pending',
        greetingNote: greetingNote?.trim() || null,
      })
      .returning();

    // Both sides' lists change (incoming for the target, outgoing for the sender).
    await publishGatewayEvent(app, 'RELATIONSHIP_ADD', { affiliation: newAffiliation }, { transmitterIds: [targetId, token.transmitterId] });

    return reply.status(201).send({
      message: 'Affiliation request dispatched',
      affiliation: newAffiliation,
    });
  });

  /**
   * GET /api/v1/affiliations
   * List all affiliations (friends, incoming/outgoing requests, and blocks).
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const rows = await db
      .select()
      .from(affiliations)
      .where(
        or(
          eq(affiliations.transmitterId, token.transmitterId),
          eq(affiliations.targetId, token.transmitterId)
        )
      );

    const blocks = await db.select().from(signalBlacklist).where(and(eq(signalBlacklist.transmitterId, token.transmitterId), eq(signalBlacklist.targetType, 'transmitter')));
    const redis = (app as any).redis;

    async function withPresence(userId: string) {
      const [profile] = await db.select(AUTHOR_FIELDS).from(transmitters).where(eq(transmitters.id, userId)).limit(1);
      let presence = 'offline';
      if (redis && profile) {
        try {
          presence = (await redis.hget('presence', userId)) || 'offline';
        } catch {
          // ignore
        }
      }
      return profile ? { ...profile, presence } : null;
    }

    const relationships = [];
    for (const row of rows) {
      const otherId = row.transmitterId === token.transmitterId ? row.targetId : row.transmitterId;
      let type: string;
      if (row.status === 'accepted') type = 'friend';
      else if (row.transmitterId === token.transmitterId) type = 'outgoing';
      else type = 'incoming';
      relationships.push({
        id: row.id,
        type,
        user: await withPresence(otherId),
        note: row.greetingNote,
        since: row.updatedAt,
      });
    }
    for (const block of blocks) {
      relationships.push({
        id: block.id,
        type: 'blocked',
        user: await withPresence(block.targetId),
        note: null,
        since: block.createdAt,
      });
    }

    return reply.send({ relationships, affiliations: rows });
  });

  /**
   * POST /api/v1/affiliations/:id/accept
   * Accept affiliation request
   */
  app.post('/:id/accept', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: reqId } = request.params as { id: string };

    const [req] = await db
      .select()
      .from(affiliations)
      .where(eq(affiliations.id, reqId))
      .limit(1);

    if (!req) return reply.status(404).send({ error: 'Affiliation request not found' });

    if (req.targetId !== token.transmitterId) {
      return reply.status(403).send({ error: 'Only recipient can accept affiliation request' });
    }

    const [updated] = await db
      .update(affiliations)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(affiliations.id, reqId))
      .returning();

    await publishSessionRefresh(app, [req.transmitterId, req.targetId]);
    await publishGatewayEvent(app, 'RELATIONSHIP_ADD', { affiliation: updated }, { transmitterIds: [req.transmitterId, req.targetId] });

    return reply.send({
      message: 'Affiliation confirmed',
      affiliation: updated,
    });
  });

  /**
   * POST /api/v1/affiliations/:id/decline
   * Decline affiliation request
   */
  app.post('/:id/decline', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: reqId } = request.params as { id: string };

    const [req] = await db
      .select()
      .from(affiliations)
      .where(eq(affiliations.id, reqId))
      .limit(1);

    if (!req) return reply.status(404).send({ error: 'Affiliation request not found' });

    if (req.targetId !== token.transmitterId) {
      return reply.status(403).send({ error: 'Only recipient can decline affiliation request' });
    }

    await db.delete(affiliations).where(eq(affiliations.id, reqId));
    await publishGatewayEvent(app, 'RELATIONSHIP_REMOVE', { affiliationId: reqId }, { transmitterIds: [req.transmitterId, req.targetId] });

    return reply.send({ message: 'Affiliation request dismissed' });
  });

  /**
   * DELETE /api/v1/affiliations/:userId
   * Unfriend, or cancel/decline a pending request, with the given transmitter.
   */
  app.delete('/:userId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { userId } = request.params as { userId: string };

    const [row] = await db
      .select()
      .from(affiliations)
      .where(
        or(
          and(eq(affiliations.transmitterId, token.transmitterId), eq(affiliations.targetId, userId)),
          and(eq(affiliations.transmitterId, userId), eq(affiliations.targetId, token.transmitterId))
        )
      )
      .limit(1);

    if (!row) return reply.status(404).send({ error: 'No affiliation with this transmitter' });

    await db.delete(affiliations).where(eq(affiliations.id, row.id));
    await publishSessionRefresh(app, [token.transmitterId, userId]);
    await publishGatewayEvent(app, 'RELATIONSHIP_REMOVE', { affiliationId: row.id }, { transmitterIds: [token.transmitterId, userId] });

    return reply.send({ message: 'Affiliation removed' });
  });
};
