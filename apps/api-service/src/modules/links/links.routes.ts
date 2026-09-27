import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  or,
  desc,
  pointToPointLinks,
  transmissions,
  transmitters,
  affiliations,
  transmissionRequests,
  beaconMembers,
  signalBlacklist,
} from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';

const MAX_TRANSMISSION_LENGTH = 2000;

export const linkRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/links
   * List all active Point-to-Point links for requesting transmitter
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const links = await db
      .select()
      .from(pointToPointLinks)
      .where(
        or(
          eq(pointToPointLinks.transmitter1Id, token.transmitterId),
          eq(pointToPointLinks.transmitter2Id, token.transmitterId)
        )
      )
      .orderBy(desc(pointToPointLinks.updatedAt));

    return reply.send({ links });
  });

  /**
   * POST /api/v1/links/:targetId/transmissions
   * Send a direct message to a target transmitter.
   * Logic:
   * 1. Check if target has blocked sender -> 403 SIGNAL_BLOCKED.
   * 2. Check if users are affiliated (friends) or have an accepted transmission request.
   *    -> If YES: deliver transmission directly into Point-to-Point Link.
   *    -> If NO: Transmission Request Gate:
   *         a) Check if they share at least one mutual Beacon. If NO -> 403 NO_SHARED_BEACON.
   *         b) Check if there is already a pending transmission request:
   *            - If request exists and not expired: reject 2nd transmission -> 403 TRANSMISSION_REQUEST_PENDING.
   *            - If request timed out (>7 days): allow creating new request.
   *         c) Create new transmission request with 7-day expiry and deliver the 1 initial transmission.
   */
  app.post('/:targetId/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { targetId } = request.params as { targetId: string };
    const senderId = token.transmitterId;

    if (senderId === targetId) {
      return reply.status(400).send({ error: 'Cannot establish link with self' });
    }

    // 1. Check blacklist
    const isBlocked = await db
      .select()
      .from(signalBlacklist)
      .where(
        or(
          and(
            eq(signalBlacklist.transmitterId, targetId),
            eq(signalBlacklist.targetId, senderId),
            eq(signalBlacklist.targetType, 'transmitter')
          ),
          and(
            eq(signalBlacklist.transmitterId, senderId),
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

    const body = request.body as any;
    const { content } = body || {};

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Transmission content cannot be empty' });
    }

    if (content.length > MAX_TRANSMISSION_LENGTH) {
      return reply.status(400).send({
        error: `Transmission exceeds maximum allowed length of ${MAX_TRANSMISSION_LENGTH} characters`,
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
      });
    }

    // 2. Check affiliation status (friends)
    const [friendship] = await db
      .select()
      .from(affiliations)
      .where(
        and(
          eq(affiliations.status, 'accepted'),
          or(
            and(eq(affiliations.transmitterId, senderId), eq(affiliations.targetId, targetId)),
            and(eq(affiliations.transmitterId, targetId), eq(affiliations.targetId, senderId))
          )
        )
      )
      .limit(1);

    // 3. Check accepted transmission request
    const [acceptedRequest] = await db
      .select()
      .from(transmissionRequests)
      .where(
        and(
          eq(transmissionRequests.status, 'accepted'),
          or(
            and(eq(transmissionRequests.senderId, senderId), eq(transmissionRequests.recipientId, targetId)),
            and(eq(transmissionRequests.senderId, targetId), eq(transmissionRequests.recipientId, senderId))
          )
        )
      )
      .limit(1);

    const isAuthorizedDM = Boolean(friendship || acceptedRequest);

    if (isAuthorizedDM) {
      // Find or create Point-to-Point Link
      let [link] = await db
        .select()
        .from(pointToPointLinks)
        .where(
          or(
            and(eq(pointToPointLinks.transmitter1Id, senderId), eq(pointToPointLinks.transmitter2Id, targetId)),
            and(eq(pointToPointLinks.transmitter1Id, targetId), eq(pointToPointLinks.transmitter2Id, senderId))
          )
        )
        .limit(1);

      if (!link) {
        [link] = await db
          .insert(pointToPointLinks)
          .values({
            transmitter1Id: senderId,
            transmitter2Id: targetId,
          })
          .returning();
      }

      const [newTransmission] = await db
        .insert(transmissions)
        .values({
          p2pLinkId: link.id,
          transmitterId: senderId,
          content: content.trim(),
        })
        .returning();

      const redis = (app as any).redis;
      if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
        redis.publish('gateway:transmission:events', JSON.stringify({
          type: 'DIRECT_TRANSMISSION_CREATE',
          link_id: link.id,
          recipient_id: targetId,
          sender_id: senderId,
          transmission: newTransmission,
        })).catch(() => {});
      }

      return reply.status(201).send({
        message: 'Point-to-Point transmission dispatched',
        transmission: newTransmission,
        linkId: link.id,
      });
    }

    // 4. Transmission Request Gate (Non-affiliated users)
    // Find mutual beacons
    const senderBeacons = await db
      .select({ beaconId: beaconMembers.beaconId })
      .from(beaconMembers)
      .where(eq(beaconMembers.transmitterId, senderId));

    const targetBeacons = await db
      .select({ beaconId: beaconMembers.beaconId })
      .from(beaconMembers)
      .where(eq(beaconMembers.transmitterId, targetId));

    const senderSet = new Set(senderBeacons.map((b: any) => b.beaconId));
    const mutualBeacon = targetBeacons.find((b: any) => senderSet.has(b.beaconId));

    if (!mutualBeacon) {
      return reply.status(403).send({
        error: 'Cannot initiate transmission link without sharing a mutual Beacon',
        code: 'NO_SHARED_BEACON',
      });
    }

    // Check existing transmission requests between sender and target
    const [existingRequest] = await db
      .select()
      .from(transmissionRequests)
      .where(
        and(
          eq(transmissionRequests.senderId, senderId),
          eq(transmissionRequests.recipientId, targetId),
          eq(transmissionRequests.status, 'pending')
        )
      )
      .limit(1);

    const now = new Date();

    if (existingRequest) {
      if (existingRequest.expiresAt > now) {
        // Still pending and within 7-day window -> block second transmission
        return reply.status(403).send({
          error: 'A transmission request is already pending review by the recipient',
          code: 'TRANSMISSION_REQUEST_PENDING',
          requestId: existingRequest.id,
          expiresAt: existingRequest.expiresAt,
        });
      } else {
        // Timed out -> mark as timed_out
        await db
          .update(transmissionRequests)
          .set({ status: 'timed_out' })
          .where(eq(transmissionRequests.id, existingRequest.id));
      }
    }

    // Create 1st introductory transmission request expiring in 7 days
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [newRequest] = await db
      .insert(transmissionRequests)
      .values({
        senderId,
        recipientId: targetId,
        mutualBeaconId: mutualBeacon.beaconId,
        initialTransmission: content.trim(),
        status: 'pending',
        expiresAt,
      })
      .returning();

    const redis = (app as any).redis;
    if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
      redis.publish('gateway:transmission:events', JSON.stringify({
        type: 'TRANSMISSION_REQUEST_CREATE',
        recipient_id: targetId,
        sender_id: senderId,
        request: newRequest,
      })).catch(() => {});
    }

    return reply.status(201).send({
      message: 'Transmission request dispatched to recipient',
      request: newRequest,
      isIntroductoryRequest: true,
      expiresAt,
    });
  });

  /**
   * GET /api/v1/links/:linkId/transmissions
   * Fetch P2P message history
   */
  app.get('/:linkId/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { linkId } = request.params as { linkId: string };

    const [link] = await db
      .select()
      .from(pointToPointLinks)
      .where(eq(pointToPointLinks.id, linkId))
      .limit(1);

    if (!link) return reply.status(404).send({ error: 'Link not found' });

    if (link.transmitter1Id !== token.transmitterId && link.transmitter2Id !== token.transmitterId) {
      return reply.status(403).send({ error: 'Access denied to this Point-to-Point Link' });
    }

    const messages = await db
      .select({
        id: transmissions.id,
        p2pLinkId: transmissions.p2pLinkId,
        transmitterId: transmissions.transmitterId,
        content: transmissions.content,
        attachments: transmissions.attachments,
        isEdited: transmissions.isEdited,
        createdAt: transmissions.createdAt,
        authorName: transmitters.displayName,
        authorUsername: transmitters.username,
      })
      .from(transmissions)
      .innerJoin(transmitters, eq(transmissions.transmitterId, transmitters.id))
      .where(eq(transmissions.p2pLinkId, linkId))
      .orderBy(desc(transmissions.createdAt))
      .limit(50);

    return reply.send({ transmissions: messages });
  });
};
