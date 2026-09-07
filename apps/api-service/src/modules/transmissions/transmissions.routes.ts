import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  desc,
  relays,
  transmissions,
  transmitters,
  signalBlacklist,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import {
  extractAuthToken,
  resolveBeaconActorContext,
  assertCanModerateTarget,
} from '../../middleware/hierarchy.js';

const MAX_TRANSMISSION_LENGTH = 2000;

export const transmissionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/relays/:relayId/transmissions
   * Post a transmission to a text relay.
   * Invariants:
   * 1. 2000-char maximum length.
   * 2. Member must have completed onboarding.
   * 3. Requires SEND_TRANSMISSIONS permission.
   */
  app.post('/relays/:relayId/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { relayId } = request.params as { relayId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!targetRelay) {
      return reply.status(404).send({ error: 'Relay not found' });
    }

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, targetRelay.beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !actorContext.member.hasCompletedOnboarding) {
      return reply.status(403).send({
        error: 'Must complete Beacon onboarding rules agreement before transmitting',
        code: 'ONBOARDING_REQUIRED',
      });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.SEND_TRANSMISSIONS)) {
      return reply.status(403).send({ error: 'Transmitter lacks SEND_TRANSMISSIONS clearance' });
    }

    const body = request.body as any;
    const { content, attachments } = body || {};

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Transmission content cannot be empty' });
    }

    if (content.length > MAX_TRANSMISSION_LENGTH) {
      return reply.status(400).send({
        error: `Transmission exceeds maximum allowed length of ${MAX_TRANSMISSION_LENGTH} characters`,
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
        length: content.length,
        maxLength: MAX_TRANSMISSION_LENGTH,
      });
    }

    const [newTransmission] = await db
      .insert(transmissions)
      .values({
        relayId,
        transmitterId: token.transmitterId,
        content: content.trim(),
        attachments: Array.isArray(attachments) ? attachments : [],
      })
      .returning();

    const [authorProfile] = await db
      .select({
        id: transmitters.id,
        username: transmitters.username,
        discriminator: transmitters.discriminator,
        displayName: transmitters.displayName,
        displayColor: transmitters.displayColor,
        avatarUrl: transmitters.avatarUrl,
        staffRank: transmitters.staffRank,
      })
      .from(transmitters)
      .where(eq(transmitters.id, token.transmitterId))
      .limit(1);

    return reply.status(201).send({
      message: 'Transmission dispatched',
      transmission: {
        ...newTransmission,
        author: authorProfile || null,
        authorName: authorProfile?.displayName || authorProfile?.username || 'Transmitter',
        authorUsername: authorProfile?.username || 'transmitter',
        authorAvatar: authorProfile?.avatarUrl || null,
      },
    });
  });

  /**
   * GET /api/v1/relays/:relayId/transmissions
   * Fetch paginated transmissions for a relay, filtering out transmitters blocked by the caller
   */
  app.get('/relays/:relayId/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { relayId } = request.params as { relayId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!targetRelay) return reply.status(404).send({ error: 'Relay not found' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, targetRelay.beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
      return reply.status(403).send({ error: 'Transmitter lacks VIEW_RELAY clearance' });
    }

    // Get blocked transmitters
    const blocks = await db
      .select()
      .from(signalBlacklist)
      .where(
        and(
          eq(signalBlacklist.transmitterId, token.transmitterId),
          eq(signalBlacklist.targetType, 'transmitter')
        )
      );
    const blockedIds = new Set(blocks.map((b: any) => b.targetId));

    const messages = await db
      .select({
        id: transmissions.id,
        relayId: transmissions.relayId,
        transmitterId: transmissions.transmitterId,
        content: transmissions.content,
        attachments: transmissions.attachments,
        isEdited: transmissions.isEdited,
        createdAt: transmissions.createdAt,
        updatedAt: transmissions.updatedAt,
        authorId: transmitters.id,
        authorUsername: transmitters.username,
        authorDiscriminator: transmitters.discriminator,
        authorDisplayName: transmitters.displayName,
        authorDisplayColor: transmitters.displayColor,
        authorAvatar: transmitters.avatarUrl,
        authorStaffRank: transmitters.staffRank,
      })
      .from(transmissions)
      .innerJoin(transmitters, eq(transmissions.transmitterId, transmitters.id))
      .where(eq(transmissions.relayId, relayId))
      .orderBy(desc(transmissions.createdAt))
      .limit(50);

    const filtered = messages
      .filter((m: any) => !blockedIds.has(m.transmitterId))
      .map((m: any) => ({
        id: m.id,
        relayId: m.relayId,
        transmitterId: m.transmitterId,
        authorId: m.authorId,
        content: m.content,
        attachments: m.attachments,
        isEdited: m.isEdited,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        authorName: m.authorDisplayName,
        authorUsername: m.authorUsername,
        authorAvatar: m.authorAvatar,
        author: {
          id: m.authorId,
          username: m.authorUsername,
          discriminator: m.authorDiscriminator,
          displayName: m.authorDisplayName,
          displayColor: m.authorDisplayColor,
          avatarUrl: m.authorAvatar,
          staffRank: m.authorStaffRank,
        },
      }))
      // Return chronologically (oldest to newest) for client message feed
      .reverse();

    return reply.send({ transmissions: filtered });
  });

  /**
   * PATCH /api/v1/transmissions/:id
   * Edit a transmission (author only)
   */
  app.patch('/transmissions/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: transmissionId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [existing] = await db
      .select()
      .from(transmissions)
      .where(eq(transmissions.id, transmissionId))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });

    if (existing.transmitterId !== token.transmitterId) {
      return reply.status(403).send({ error: 'Only the original transmitter can modify this signal' });
    }

    const body = request.body as any;
    const { content } = body || {};

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Content cannot be empty' });
    }

    if (content.length > MAX_TRANSMISSION_LENGTH) {
      return reply.status(400).send({
        error: `Transmission exceeds maximum allowed length of ${MAX_TRANSMISSION_LENGTH} characters`,
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
      });
    }

    const [updated] = await db
      .update(transmissions)
      .set({
        content: content.trim(),
        isEdited: true,
        updatedAt: new Date(),
      })
      .where(eq(transmissions.id, transmissionId))
      .returning();

    return reply.send({
      message: 'Transmission updated',
      transmission: updated,
    });
  });

  /**
   * DELETE /api/v1/transmissions/:id
   * Delete a transmission (author, or moderator with MANAGE_TRANSMISSIONS following hierarchy)
   */
  app.delete('/transmissions/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: transmissionId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [existing] = await db
      .select()
      .from(transmissions)
      .where(eq(transmissions.id, transmissionId))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });

    // Author can always delete their own transmission
    if (existing.transmitterId === token.transmitterId) {
      await db.delete(transmissions).where(eq(transmissions.id, transmissionId));
      return reply.send({ message: 'Transmission erased' });
    }

    // Otherwise must be in a Beacon Relay and have MANAGE_TRANSMISSIONS + hierarchy authority
    if (!existing.relayId) {
      return reply.status(403).send({ error: 'Cannot delete other transmitters direct messages' });
    }

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, existing.relayId))
      .limit(1);

    if (!targetRelay) return reply.status(404).send({ error: 'Relay not found' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, targetRelay.beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_TRANSMISSIONS clearance' });
    }

    const canModerate = await assertCanModerateTarget(db, actorContext, existing.transmitterId, reply);
    if (!canModerate) return;

    await db.delete(transmissions).where(eq(transmissions.id, transmissionId));

    return reply.send({ message: 'Transmission erased by clearance moderator' });
  });
};
