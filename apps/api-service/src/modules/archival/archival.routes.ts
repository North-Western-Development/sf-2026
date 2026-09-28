import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  desc,
  asc,
  relays,
  archivalThreads,
  transmissions,
  transmitters,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext, resolveRelayActorContext } from '../../middleware/hierarchy.js';

export const archivalRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * Helper: verify caller has access to the archival relay
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
    if (targetRelay.type !== 'archival') {
      reply.status(400).send({ error: 'Target relay is not an Archival Relay' });
      return null;
    }

    return { token, targetRelay, actorContext };
  }

  /**
   * POST /api/v1/relays/:relayId/archival/threads
   * Create a new Archival Thread with root transmission
   */
  app.post('/threads', async (request, reply) => {
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
    const { title, content, tags, attachments } = body || {};

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return reply.status(400).send({ error: 'Thread title is required' });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Initial transmission content is required' });
    }

    if (content.length > 2000) {
      return reply.status(400).send({
        error: 'Transmission exceeds maximum allowed length of 2000 characters',
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
      });
    }

    const formattedTags: string[] = Array.isArray(tags)
      ? tags.map((t: string) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 5)
      : [];

    // 1. Create thread
    const [thread] = await db
      .insert(archivalThreads)
      .values({
        relayId: targetRelay.id,
        transmitterId: token.transmitterId,
        title: title.trim(),
        tags: formattedTags,
        transmissionCount: 1,
        lastTransmissionAt: new Date(),
      })
      .returning();

    // 2. Create root transmission linked to thread
    const [rootTransmission] = await db
      .insert(transmissions)
      .values({
        relayId: targetRelay.id,
        threadId: thread.id,
        transmitterId: token.transmitterId,
        content: content.trim(),
        attachments: Array.isArray(attachments) ? attachments : [],
      })
      .returning();

    // 3. Update thread with rootTransmissionId
    const [updatedThread] = await db
      .update(archivalThreads)
      .set({ rootTransmissionId: rootTransmission.id })
      .where(eq(archivalThreads.id, thread.id))
      .returning();

    return reply.status(201).send({
      message: 'Archival thread created',
      thread: updatedThread,
      rootTransmission,
    });
  });

  /**
   * GET /api/v1/relays/:relayId/archival/threads
   * List threads in an Archival Relay (pinned first, then by lastTransmissionAt desc)
   */
  app.get('/threads', async (request, reply) => {
    const ctx = await resolveRelayContext(request, reply);
    if (!ctx) return;

    const { targetRelay } = ctx;
    const query = request.query as any;
    const tagFilter = query.tag ? String(query.tag).trim().toLowerCase() : null;

    const threadsList = await db
      .select({
        thread: archivalThreads,
        author: {
          id: transmitters.id,
          username: transmitters.username,
          displayName: transmitters.displayName,
          avatarUrl: transmitters.avatarUrl,
        },
      })
      .from(archivalThreads)
      .innerJoin(transmitters, eq(archivalThreads.transmitterId, transmitters.id))
      .where(eq(archivalThreads.relayId, targetRelay.id))
      .orderBy(desc(archivalThreads.isPinned), desc(archivalThreads.lastTransmissionAt));

    let filtered = threadsList;
    if (tagFilter) {
      filtered = threadsList.filter((item: any) =>
        Array.isArray(item.thread.tags) && item.thread.tags.includes(tagFilter)
      );
    }

    return reply.send({
      relayId: targetRelay.id,
      threads: filtered,
    });
  });

  /**
   * GET /api/v1/relays/:relayId/archival/threads/:threadId
   * Get thread details + root transmission
   */
  app.get('/threads/:threadId', async (request, reply) => {
    const ctx = await resolveRelayContext(request, reply);
    if (!ctx) return;

    const { threadId } = request.params as { threadId: string };

    const [threadRecord] = await db
      .select({
        thread: archivalThreads,
        author: {
          id: transmitters.id,
          username: transmitters.username,
          displayName: transmitters.displayName,
          avatarUrl: transmitters.avatarUrl,
        },
      })
      .from(archivalThreads)
      .innerJoin(transmitters, eq(archivalThreads.transmitterId, transmitters.id))
      .where(eq(archivalThreads.id, threadId))
      .limit(1);

    if (!threadRecord) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    let rootTransmission = null;
    if (threadRecord.thread.rootTransmissionId) {
      const [root] = await db
        .select()
        .from(transmissions)
        .where(eq(transmissions.id, threadRecord.thread.rootTransmissionId))
        .limit(1);
      rootTransmission = root || null;
    }

    return reply.send({
      thread: threadRecord.thread,
      author: threadRecord.author,
      rootTransmission,
    });
  });

  /**
   * POST /api/v1/relays/:relayId/archival/threads/:threadId/transmissions
   * Post a reply to an Archival Thread
   */
  app.post('/threads/:threadId/transmissions', async (request, reply) => {
    const ctx = await resolveRelayContext(request, reply);
    if (!ctx) return;

    const { token, targetRelay, actorContext } = ctx;
    const { threadId } = request.params as { threadId: string };

    const [thread] = await db
      .select()
      .from(archivalThreads)
      .where(eq(archivalThreads.id, threadId))
      .limit(1);

    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    if (thread.isLocked && !actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS)) {
      return reply.status(403).send({ error: 'Thread is locked for new transmissions' });
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

    if (content.length > 2000) {
      return reply.status(400).send({
        error: 'Transmission exceeds maximum allowed length of 2000 characters',
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
      });
    }

    const now = new Date();

    const [replyTransmission] = await db
      .insert(transmissions)
      .values({
        relayId: targetRelay.id,
        threadId: thread.id,
        transmitterId: token.transmitterId,
        content: content.trim(),
        attachments: Array.isArray(attachments) ? attachments : [],
      })
      .returning();

    await db
      .update(archivalThreads)
      .set({
        transmissionCount: thread.transmissionCount + 1,
        lastTransmissionAt: now,
        updatedAt: now,
      })
      .where(eq(archivalThreads.id, thread.id));

    return reply.status(201).send({
      message: 'Transmission posted to thread',
      transmission: replyTransmission,
    });
  });

  /**
   * GET /api/v1/relays/:relayId/archival/threads/:threadId/transmissions
   * Fetch transmissions inside a thread
   */
  app.get('/threads/:threadId/transmissions', async (request, reply) => {
    const ctx = await resolveRelayContext(request, reply);
    if (!ctx) return;

    const { threadId } = request.params as { threadId: string };

    const threadTransmissions = await db
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
      .where(eq(transmissions.threadId, threadId))
      .orderBy(asc(transmissions.createdAt));

    return reply.send({
      threadId,
      transmissions: threadTransmissions,
    });
  });

  /**
   * PATCH /api/v1/relays/:relayId/archival/threads/:threadId
   * Pin/unpin or lock/unlock thread (Requires MANAGE_TRANSMISSIONS or owner)
   */
  app.patch('/threads/:threadId', async (request, reply) => {
    const ctx = await resolveRelayContext(request, reply);
    if (!ctx) return;

    const { token, actorContext } = ctx;
    const { threadId } = request.params as { threadId: string };

    const [thread] = await db
      .select()
      .from(archivalThreads)
      .where(eq(archivalThreads.id, threadId))
      .limit(1);

    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    const isAuthor = thread.transmitterId === token.transmitterId;
    if (!isAuthor && !actorContext.isOwner && !hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS)) {
      return reply.status(403).send({ error: 'Transmitter lacks clearance to modify this thread' });
    }

    const body = request.body as any;
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (body.isPinned !== undefined) updates.isPinned = Boolean(body.isPinned);
    if (body.isLocked !== undefined) updates.isLocked = Boolean(body.isLocked);
    if (body.title !== undefined && typeof body.title === 'string' && body.title.trim().length > 0) {
      updates.title = body.title.trim();
    }
    if (Array.isArray(body.tags)) {
      updates.tags = body.tags.map((t: string) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 5);
    }

    const [updated] = await db
      .update(archivalThreads)
      .set(updates)
      .where(eq(archivalThreads.id, threadId))
      .returning();

    return reply.send({
      message: 'Thread parameters updated',
      thread: updated,
    });
  });
};
