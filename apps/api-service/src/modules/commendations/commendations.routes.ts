import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  asc,
  desc,
  transmitters,
  commendations,
  transmitterCommendations,
  COMMENDATION_CATALOG,
  COMMENDATION_FAMILIES,
  badgeIconUrl,
} from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { commendationStats, refreshCommendations } from '../../lib/commendations.js';

export const commendationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/transmitters/commendations
   * Every badge there is, so clients can show the ones still to earn.
   */
  app.get('/commendations', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const [me] = await db.select().from(transmitters).where(eq(transmitters.id, token.transmitterId)).limit(1);
    if (!me) return reply.status(404).send({ error: 'Transmitter not found' });
    const stats = await commendationStats(app, db, me);
    return reply.send({
      families: COMMENDATION_FAMILIES.map((f) => ({
        ...f,
        tiers: COMMENDATION_CATALOG.filter((c) => c.family === f.family).map((c) => ({
          code: c.code,
          name: c.name,
          description: c.description,
          threshold: c.threshold,
          tier: c.tier,
          rarity: c.rarity,
          iconUrl: badgeIconUrl(c.code),
        })),
      })),
      // The caller's own totals, for the progress bars.
      progress: {
        voice_minutes: Math.floor(stats.voiceMinutes),
        transmissions_sent: stats.transmissionsSent,
        account_age: Math.floor((Date.now() - new Date(me.createdAt).getTime()) / 86_400_000),
      },
    });
  });

  /**
   * GET /api/v1/transmitters/:id/commendations
   * Fetch a transmitter's Commendation Deck
   */
  app.get('/:id/commendations', async (request, reply) => {
    const { id: transmitterId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [targetTransmitter] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.id, transmitterId))
      .limit(1);

    if (!targetTransmitter) {
      return reply.status(404).send({ error: 'Transmitter not found' });
    }

    await refreshCommendations(app, db, targetTransmitter);

    const deck = await db
      .select({
        commendationId: commendations.id,
        code: commendations.code,
        name: commendations.name,
        description: commendations.description,
        iconUrl: commendations.iconUrl,
        criteriaType: commendations.criteriaType,
        displayOrder: transmitterCommendations.displayOrder,
        isVisible: transmitterCommendations.isVisible,
        awardedAt: transmitterCommendations.awardedAt,
      })
      .from(transmitterCommendations)
      .innerJoin(commendations, eq(transmitterCommendations.commendationId, commendations.id))
      .where(eq(transmitterCommendations.transmitterId, transmitterId))
      .orderBy(asc(transmitterCommendations.displayOrder), desc(transmitterCommendations.awardedAt));

    return reply.send({
      transmitterId,
      deck,
    });
  });

  /**
   * PATCH /api/v1/transmitters/me/commendations
   * Customize Commendation Deck (reorder, toggle visibility)
   * INVARIANT: Staff Insignias (criteriaType === 'staff') cannot be hidden!
   */
  app.patch('/me/commendations', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const body = request.body as any;
    const { updates } = body || {};

    if (!Array.isArray(updates)) {
      return reply.status(400).send({ error: 'updates array is required' });
    }

    for (const update of updates) {
      const { commendationId, displayOrder, isVisible } = update;
      if (!commendationId) continue;

      // Check if this badge is a staff insignia
      const [badge] = await db
        .select()
        .from(commendations)
        .where(eq(commendations.id, commendationId))
        .limit(1);

      // INVARIANT: Mandatory Command Staff Insignia cannot be hidden
      if (badge && badge.criteriaType === 'staff' && isVisible === false) {
        return reply.status(400).send({
          error: 'Command Staff Insignia is mandatory and cannot be hidden from display',
          code: 'CANNOT_HIDE_STAFF_INSIGNIA',
          commendationCode: badge.code,
        });
      }

      const updateData: Record<string, any> = {};
      if (displayOrder !== undefined) updateData.displayOrder = Number(displayOrder);
      if (isVisible !== undefined) updateData.isVisible = Boolean(isVisible);

      if (Object.keys(updateData).length > 0) {
        await db
          .update(transmitterCommendations)
          .set(updateData)
          .where(
            and(
              eq(transmitterCommendations.transmitterId, token.transmitterId),
              eq(transmitterCommendations.commendationId, commendationId)
            )
          );
      }
    }

    return reply.send({ message: 'Commendation Deck updated successfully' });
  });
};
