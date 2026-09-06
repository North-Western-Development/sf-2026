import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  asc,
  desc,
  transmitters,
  commendations,
  transmitterCommendations,
} from '@subspace/database';
import { STAFF_RANKS } from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';

export const commendationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * Helper: ensure transmitter has appropriate staff commendation if staffRank > 0
   */
  async function ensureStaffCommendation(transmitterId: string, staffRank: number) {
    if (staffRank === STAFF_RANKS.NONE) return;

    let code = 'STAFF_MODERATOR';
    let name = 'Command Staff - Moderator';
    if (staffRank === STAFF_RANKS.ADMIN) {
      code = 'STAFF_ADMIN';
      name = 'Command Staff - Administrator';
    } else if (staffRank === STAFF_RANKS.ROOT) {
      code = 'STAFF_COMMAND';
      name = 'Command Staff - Commander in Chief';
    }

    // Find or create commendation
    let [badge] = await db
      .select()
      .from(commendations)
      .where(eq(commendations.code, code))
      .limit(1);

    if (!badge) {
      [badge] = await db
        .insert(commendations)
        .values({
          code,
          name,
          description: 'Official Subspace Frequency Command Staff Insignia',
          iconUrl: `/assets/insignias/${code.toLowerCase()}.png`,
          criteriaType: 'staff',
          threshold: staffRank,
        })
        .returning();
    }

    // Award if not already present
    const [existing] = await db
      .select()
      .from(transmitterCommendations)
      .where(
        and(
          eq(transmitterCommendations.transmitterId, transmitterId),
          eq(transmitterCommendations.commendationId, badge.id)
        )
      )
      .limit(1);

    if (!existing) {
      await db
        .insert(transmitterCommendations)
        .values({
          transmitterId,
          commendationId: badge.id,
          displayOrder: 0,
          isVisible: true,
        });
    }
  }

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

    // Synchronize staff insignia if applicable
    if (targetTransmitter.staffRank > 0) {
      await ensureStaffCommendation(targetTransmitter.id, targetTransmitter.staffRank);
    }

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
