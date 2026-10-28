import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  or,
  desc,
  gt,
  notInArray,
  pointToPointLinks,
  pointToPointLinkHidden,
  transmissions,
  transmitters,
  affiliations,
  transmissionRequests,
  beaconMembers,
  signalBlacklist,
} from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';
import { loadChannel } from '../../lib/channels.js';
import { touchChannelLastTransmission } from '../../lib/read-state.js';
import { AUTHOR_FIELDS } from '../../lib/transmissions.js';
import { scheduleEmbeds } from '../../lib/embeds.js';
import { isQuarantined, QUARANTINED } from '../../lib/quarantine.js';
import { dmAccess } from '../../lib/dm-access.js';

const MAX_TRANSMISSION_LENGTH = 2000;

/**
 * Discord's spam filter for message requests, as heuristics: a sender who has sent several
 * requests in the last hour, or a brand-new account (under a day old) whose first message
 * carries a link or an invite.
 */
export async function looksLikeSpam(db: any, senderId: string, content: string): Promise<boolean> {
  const hourAgo = new Date(Date.now() - 3600_000);
  const recent = await db
    .select({ id: transmissionRequests.id })
    .from(transmissionRequests)
    .where(and(eq(transmissionRequests.senderId, senderId), gt(transmissionRequests.createdAt, hourAgo)));
  if (recent.length >= 3) return true;
  const [sender] = await db.select({ createdAt: transmitters.createdAt }).from(transmitters).where(eq(transmitters.id, senderId)).limit(1);
  const fresh = !!sender && Date.now() - new Date(sender.createdAt).getTime() < 86_400_000;
  return fresh && /https?:\/\/|\/invite\//i.test(content);
}

async function isBlocked(db: any, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(signalBlacklist)
    .where(
      or(
        and(eq(signalBlacklist.transmitterId, a), eq(signalBlacklist.targetId, b), eq(signalBlacklist.targetType, 'transmitter')),
        and(eq(signalBlacklist.transmitterId, b), eq(signalBlacklist.targetId, a), eq(signalBlacklist.targetType, 'transmitter'))
      )
    )
    .limit(1);
  return !!row;
}

export const linkRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/links
   * List active Point-to-Point Links for the caller (excludes ones the caller hid), sorted by activity.
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const hidden = await db.select().from(pointToPointLinkHidden).where(eq(pointToPointLinkHidden.transmitterId, token.transmitterId));
    const hiddenIds = hidden.map((h: any) => h.linkId);

    let links = await db
      .select()
      .from(pointToPointLinks)
      .where(or(eq(pointToPointLinks.transmitter1Id, token.transmitterId), eq(pointToPointLinks.transmitter2Id, token.transmitterId)))
      .orderBy(desc(pointToPointLinks.updatedAt));

    if (hiddenIds.length > 0) links = links.filter((l: any) => !hiddenIds.includes(l.id));

    const redis = (app as any).redis;
    const out = [];
    for (const link of links) {
      const recipientId = link.transmitter1Id === token.transmitterId ? link.transmitter2Id : link.transmitter1Id;
      const [recipient] = await db.select(AUTHOR_FIELDS).from(transmitters).where(eq(transmitters.id, recipientId)).limit(1);
      let presence = 'offline';
      if (redis && recipient) {
        try {
          presence = (await redis.hget('presence', recipientId)) || 'offline';
        } catch {
          // ignore
        }
      }
      out.push({
        id: link.id,
        recipient: recipient ? { ...recipient, presence } : null,
        lastTransmissionId: link.lastTransmissionId,
        lastTransmissionAt: link.lastTransmissionAt,
        encryptedAt: link.encryptedAt ?? null,
      });
    }

    return reply.send({ links: out });
  });

  /**
   * POST /api/v1/links
   * Open (or return) a Point-to-Point Link without sending a transmission.
   * Allowed if affiliated, or sharing a beacon and not blocked.
   */
  app.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['targetId'],
          properties: { targetId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { targetId } = request.body as { targetId: string };
      if (targetId === token.transmitterId) return reply.status(400).send({ error: 'Cannot open a link with self' });

      const [target] = await db.select().from(transmitters).where(eq(transmitters.id, targetId)).limit(1);
      if (!target) return reply.status(404).send({ error: 'Transmitter not found' });

      if (await isBlocked(db, token.transmitterId, targetId)) {
        return reply.status(403).send({ error: 'Communication blocked by signal filter', code: 'SIGNAL_BLOCKED' });
      }

      const [friendship] = await db
        .select()
        .from(affiliations)
        .where(
          and(
            eq(affiliations.status, 'accepted'),
            or(
              and(eq(affiliations.transmitterId, token.transmitterId), eq(affiliations.targetId, targetId)),
              and(eq(affiliations.transmitterId, targetId), eq(affiliations.targetId, token.transmitterId))
            )
          )
        )
        .limit(1);

      // Quarantined accounts can still message their friends, nobody new.
      if (!friendship && (await isQuarantined(db, token.transmitterId))) return reply.status(403).send(QUARANTINED);
      if (!friendship) {
        // A shared beacon counts only where they allow DMs from members (its Privacy Settings).
        const access = await dmAccess(db, token.transmitterId, targetId);
        if (!access.ok) {
          return reply
            .status(403)
            .send(access.code === 'DMS_DISABLED' ? { error: access.error, code: access.code } : { error: 'Cannot open a link with this transmitter', code: 'LINK_NOT_ALLOWED' });
        }
      }

      let [link] = await db
        .select()
        .from(pointToPointLinks)
        .where(
          or(
            and(eq(pointToPointLinks.transmitter1Id, token.transmitterId), eq(pointToPointLinks.transmitter2Id, targetId)),
            and(eq(pointToPointLinks.transmitter1Id, targetId), eq(pointToPointLinks.transmitter2Id, token.transmitterId))
          )
        )
        .limit(1);

      if (!link) {
        [link] = await db.insert(pointToPointLinks).values({ transmitter1Id: token.transmitterId, transmitter2Id: targetId }).returning();
      }

      await db.delete(pointToPointLinkHidden).where(and(eq(pointToPointLinkHidden.transmitterId, token.transmitterId), eq(pointToPointLinkHidden.linkId, link.id)));

      // Same shape as GET /links so the client can show who the DM is with.
      const [recipient] = await db.select(AUTHOR_FIELDS).from(transmitters).where(eq(transmitters.id, targetId)).limit(1);
      return reply.status(201).send({
        link: { ...link, recipient, lastTransmissionId: link.lastTransmissionId, lastTransmissionAt: link.lastTransmissionAt },
      });
    }
  );

  /**
   * DELETE /api/v1/links/:linkId
   * Hides the DM from the caller's list. A new message un-hides it.
   */
  app.delete('/:linkId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { linkId } = request.params as { linkId: string };
    const [link] = await db.select().from(pointToPointLinks).where(eq(pointToPointLinks.id, linkId)).limit(1);
    if (!link) return reply.status(404).send({ error: 'Link not found' });
    if (link.transmitter1Id !== token.transmitterId && link.transmitter2Id !== token.transmitterId) {
      return reply.status(403).send({ error: 'Access denied to this Point-to-Point Link' });
    }

    await db
      .insert(pointToPointLinkHidden)
      .values({ transmitterId: token.transmitterId, linkId })
      .onConflictDoNothing();

    return reply.send({ message: 'Link hidden' });
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

    if (await isBlocked(db, senderId, targetId)) {
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

    // Everyone else goes through a request here (this is also where a DM turned away by the
    // recipient's Message Requests is sent).
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
      if (link.encryptedAt) {
        return reply.status(400).send({ error: 'This conversation is end-to-end encrypted; send ciphertext only', code: 'ENCRYPTION_REQUIRED' });
      }

      const [newTransmission] = await db
        .insert(transmissions)
        .values({
          p2pLinkId: link.id,
          transmitterId: senderId,
          content: content.trim(),
        })
        .returning();

      const channel = await loadChannel(db, 'link', link.id);
      if (channel) await touchChannelLastTransmission(db, channel, newTransmission.id, newTransmission.createdAt);
      scheduleEmbeds(app, newTransmission);

      // Carry the author, so the recipient can name a sender it has never seen (DM list, notification).
      const [author] = await db.select(AUTHOR_FIELDS).from(transmitters).where(eq(transmitters.id, senderId)).limit(1);
      const transmission = { ...newTransmission, author: author ?? null };
      await publishGatewayEvent(
        app,
        'DIRECT_TRANSMISSION_CREATE',
        { link_id: link.id, recipient_id: targetId, sender_id: senderId, transmission },
        { transmitterIds: [senderId, targetId] }
      );

      return reply.status(201).send({
        message: 'Point-to-Point transmission dispatched',
        transmission,
        linkId: link.id,
      });
    }

    // 4. Transmission Request Gate (Non-affiliated users): needs a shared beacon where the
    // target allows DMs from members.
    if (await isQuarantined(db, senderId)) return reply.status(403).send(QUARANTINED);
    const access = await dmAccess(db, senderId, targetId);
    if (!access.ok) return reply.status(403).send({ error: access.error, code: access.code });
    const mutualBeacon = { beaconId: access.beaconId! };

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

    const isSpam = await looksLikeSpam(db, senderId, content);
    const [newRequest] = await db
      .insert(transmissionRequests)
      .values({
        senderId,
        recipientId: targetId,
        mutualBeaconId: mutualBeacon.beaconId,
        initialTransmission: content.trim(),
        status: 'pending',
        isSpam,
        expiresAt,
      })
      .returning();

    await publishGatewayEvent(
      app,
      'TRANSMISSION_REQUEST_CREATE',
      { recipient_id: targetId, sender_id: senderId, request: newRequest },
      { transmitterIds: [senderId, targetId] }
    );

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
