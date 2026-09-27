import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, or, affiliations, transmitters, signalBlacklist } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishSessionRefresh } from '../../lib/events.js';

const MAX_GREETING_NOTE_LENGTH = 200;

export const affiliationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/affiliations/request
   * Send an affiliation (friend) request with an optional greeting note (up to 200 chars)
   */
  app.post('/request', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const body = request.body as any;
    const { targetId, greetingNote } = body || {};

    if (!targetId || typeof targetId !== 'string') {
      return reply.status(400).send({ error: 'targetId required' });
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

    return reply.status(201).send({
      message: 'Affiliation request dispatched',
      affiliation: newAffiliation,
    });
  });

  /**
   * GET /api/v1/affiliations
   * List all affiliations (friends and pending requests)
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const all = await db
      .select()
      .from(affiliations)
      .where(
        or(
          eq(affiliations.transmitterId, token.transmitterId),
          eq(affiliations.targetId, token.transmitterId)
        )
      );

    return reply.send({ affiliations: all });
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

    return reply.send({ message: 'Affiliation request dismissed' });
  });
};
