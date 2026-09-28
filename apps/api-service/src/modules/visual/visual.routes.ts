import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  desc,
  relays,
  transmissions,
  transmitters,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext, resolveRelayActorContext } from '../../middleware/hierarchy.js';

export const visualRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * Helper: verify caller has access to the visual relay
   */
  async function resolveRelayContext(request: any, reply: any) {
    const token = extractAuthToken(request);
    if (!token) {
      reply.status(401).send({ error: 'Authentication required' });
      return null;
    }

    const { relayId } = request.params as { relayId: string };
    if (!db) {
      reply.status(503).send({ error: 'Database service unavailable' });
      return null;
    }

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!targetRelay) {
      reply.status(404).send({ error: 'Relay not found' });
      return null;
    }


    const actorContext = await resolveRelayActorContext(db, token.transmitterId, targetRelay);
    if (!actorContext) {
      reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
      return null;
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
      reply.status(403).send({ error: 'Transmitter lacks VIEW_RELAY clearance' });
      return null;
    }
    if (targetRelay.type !== 'visual') {
      reply.status(400).send({ error: 'Target relay is not a Visual Relay' });
      return null;
    }

    return { token, targetRelay, actorContext };
  }

  /**
   * POST /api/v1/relays/:relayId/visual/transmissions
   * Post to a Visual Relay.
   * INVARIANT: Transmissions in a visual relay MUST have at least 1 media attachment.
   */
  app.post('/transmissions', async (request, reply) => {
    const ctx = await resolveRelayContext(request, reply);
    if (!ctx) return;

    const { token, targetRelay, actorContext } = ctx;

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

    // INVARIANT: Visual relays require media attachments
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return reply.status(400).send({
        error: 'Visual Relays require at least one visual transmission artifact (media attachment)',
        code: 'ATTACHMENT_REQUIRED',
      });
    }

    const caption = typeof content === 'string' ? content.trim() : '';
    if (caption.length > 2000) {
      return reply.status(400).send({
        error: 'Transmission caption exceeds maximum allowed length of 2000 characters',
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
      });
    }

    const [newTransmission] = await db
      .insert(transmissions)
      .values({
        relayId: targetRelay.id,
        transmitterId: token.transmitterId,
        content: caption,
        attachments,
      })
      .returning();

    return reply.status(201).send({
      message: 'Visual artifact posted',
      transmission: newTransmission,
    });
  });

  /**
   * GET /api/v1/relays/:relayId/visual/gallery
   * Fetch flattened visual gallery feed with media artifacts, captions, and authors
   */
  app.get('/gallery', async (request, reply) => {
    const ctx = await resolveRelayContext(request, reply);
    if (!ctx) return;

    const { targetRelay } = ctx;

    const records = await db
      .select({
        transmission: transmissions,
        author: {
          id: transmitters.id,
          username: transmitters.username,
          displayName: transmitters.displayName,
          avatarUrl: transmitters.avatarUrl,
        },
      })
      .from(transmissions)
      .innerJoin(transmitters, eq(transmissions.transmitterId, transmitters.id))
      .where(eq(transmissions.relayId, targetRelay.id))
      .orderBy(desc(transmissions.createdAt));

    // Flatten into media gallery items
    const galleryItems: Array<{
      transmissionId: string;
      caption: string;
      attachment: { id: string; url: string; filename: string; size: number };
      author: any;
      createdAt: Date;
    }> = [];

    for (const record of records) {
      const atts = record.transmission.attachments || [];
      for (const att of atts) {
        galleryItems.push({
          transmissionId: record.transmission.id,
          caption: record.transmission.content,
          attachment: att,
          author: record.author,
          createdAt: record.transmission.createdAt,
        });
      }
    }

    return reply.send({
      relayId: targetRelay.id,
      count: galleryItems.length,
      gallery: galleryItems,
    });
  });
};
