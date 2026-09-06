import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, beacons, beaconMembers, clearances } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';

export const onboardingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/beacons/:id/onboarding
   * Fetch beacon rules and onboarding configuration for a member
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: beaconId } = request.params as { id: string };

    const [beacon] = await db
      .select()
      .from(beacons)
      .where(eq(beacons.id, beaconId))
      .limit(1);

    if (!beacon) return reply.status(404).send({ error: 'Beacon not found' });

    const [member] = await db
      .select()
      .from(beaconMembers)
      .where(
        and(
          eq(beaconMembers.beaconId, beaconId),
          eq(beaconMembers.transmitterId, token.transmitterId)
        )
      )
      .limit(1);

    if (!member) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    // Return delegatable / opt-in clearances that can be selected during onboarding
    const optInClearances = await db
      .select({
        id: clearances.id,
        name: clearances.name,
        color: clearances.color,
        description: clearances.name,
      })
      .from(clearances)
      .where(and(eq(clearances.beaconId, beaconId), eq(clearances.allowDelegation, true)));

    return reply.send({
      beaconId: beacon.id,
      beaconName: beacon.name,
      rulesText: beacon.rulesText,
      hasCompletedOnboarding: member.hasCompletedOnboarding,
      optInClearances,
    });
  });

  /**
   * POST /api/v1/beacons/:id/onboarding/complete
   * Transmitter agrees to rules and optionally selects starter roles
   */
  app.post('/complete', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: beaconId } = request.params as { id: string };

    const [member] = await db
      .select()
      .from(beaconMembers)
      .where(
        and(
          eq(beaconMembers.beaconId, beaconId),
          eq(beaconMembers.transmitterId, token.transmitterId)
        )
      )
      .limit(1);

    if (!member) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    const body = request.body as any;
    const { agreedToRules, selectedClearanceIds } = body || {};

    if (!agreedToRules) {
      return reply.status(400).send({ error: 'Transmitter must agree to the Beacon rules to complete onboarding' });
    }

    let finalClearanceIds = (member.clearanceIds as string[]) || [];

    if (Array.isArray(selectedClearanceIds) && selectedClearanceIds.length > 0) {
      // Validate that all selected clearances allow delegation
      const validDelegatable = await db
        .select()
        .from(clearances)
        .where(
          and(
            eq(clearances.beaconId, beaconId),
            eq(clearances.allowDelegation, true)
          )
        );

      const delegatableSet = new Set(validDelegatable.map((c: any) => c.id));
      const allowedSelections = selectedClearanceIds.filter((id: string) => delegatableSet.has(id));

      finalClearanceIds = Array.from(new Set([...finalClearanceIds, ...allowedSelections]));
    }

    const [updatedMember] = await db
      .update(beaconMembers)
      .set({
        hasCompletedOnboarding: true,
        clearanceIds: finalClearanceIds,
      })
      .where(
        and(
          eq(beaconMembers.beaconId, beaconId),
          eq(beaconMembers.transmitterId, token.transmitterId)
        )
      )
      .returning();

    return reply.send({
      message: 'Onboarding completed. Full Beacon transmission access granted.',
      member: updatedMember,
    });
  });
};
