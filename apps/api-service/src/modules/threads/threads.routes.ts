import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, desc, inArray, sql, archivalThreads, relays, transmissions, threadMembers, canSeeThread, computeRelayPermissions } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { formatTransmission } from '../../lib/transmissions.js';

/** A thread as the client lists it. */
async function threadSummaries(db: any, rows: any[]) {
  if (!rows.length) return [];
  const counts = await db
    .select({ threadId: transmissions.threadId, n: sql<number>`count(*)::int` })
    .from(transmissions)
    .where(inArray(transmissions.threadId, rows.map((r) => r.id)))
    .groupBy(transmissions.threadId);
  const byId = new Map(counts.map((c: any) => [c.threadId, c.n]));
  return rows.map((t) => ({
    id: t.id,
    relayId: t.relayId,
    title: t.title,
    creatorId: t.transmitterId,
    starterTransmissionId: t.starterTransmissionId,
    isLocked: t.isLocked,
    isPrivate: !!t.isPrivate,
    messageCount: byId.get(t.id) ?? 0,
    lastTransmissionAt: t.lastTransmissionAt,
    createdAt: t.createdAt,
  }));
}

/** Adds `thread` to transmissions that started one (the chip under the message, as on Discord). */
export async function attachThreads<T extends { id: string }>(db: any, list: T[]): Promise<Array<T & { thread?: unknown }>> {
  if (!db || !list.length) return list;
  const rows = await db.select().from(archivalThreads).where(inArray(archivalThreads.starterTransmissionId, list.map((t) => t.id)));
  if (!rows.length) return list;
  const summaries = await threadSummaries(db, rows);
  const byStarter = new Map(summaries.map((s: any) => [s.starterTransmissionId, s]));
  return list.map((t) => (byStarter.has(t.id) ? { ...t, thread: byStarter.get(t.id) } : t));
}

/**
 * Threads in text relays (Discord's): started from a transmission or on their own. Their
 * transmissions use the shared channel routes with channel type 'thread'.
 *   GET    /relays/:relayId/threads                  the ones you can see
 *   POST   /relays/:relayId/threads                  { name, starterTransmissionId?, private?, members? }
 *   PATCH  /relays/:relayId/threads/:threadId        { name?, isLocked? }
 *   GET    /relays/:relayId/threads/:threadId/members
 *   PUT    /relays/:relayId/threads/:threadId/members/:userId   add someone to a private thread
 *   DELETE /relays/:relayId/threads/:threadId/members/:userId   remove them (or leave)
 * Private threads (Create Private Threads) are seen only by their members and by Manage Threads;
 * anyone in one can add others who can see the relay.
 */
export const threadRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function textRelay(request: any, reply: any) {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    const { relayId } = request.params as { relayId: string };
    const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
    if (!relay || relay.type !== 'text') return reply.status(404).send({ error: 'Text relay not found' }), null;
    const actor = await resolveRelayActorContext(db, token.transmitterId, relay);
    if (!actor || !hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY)) return reply.status(404).send({ error: 'Text relay not found' }), null;
    return { token, relay, actor };
  }

  app.get('/relays/:relayId/threads', async (request, reply) => {
    const ctx = await textRelay(request, reply);
    if (!ctx) return;
    const rows = await db.select().from(archivalThreads).where(eq(archivalThreads.relayId, ctx.relay.id)).orderBy(desc(archivalThreads.lastTransmissionAt)).limit(100);
    // Private threads only for their members and Manage Threads.
    const manager = hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.MANAGE_THREADS);
    const privateIds = rows.filter((r: any) => r.isPrivate).map((r: any) => r.id);
    const mine = !manager && privateIds.length
      ? new Set((await db.select().from(threadMembers).where(and(inArray(threadMembers.threadId, privateIds), eq(threadMembers.transmitterId, ctx.token.transmitterId)))).map((m: any) => m.threadId))
      : new Set<string>();
    const visible = rows.filter((r: any) => !r.isPrivate || manager || mine.has(r.id)).slice(0, 50);
    return reply.send({ threads: await threadSummaries(db, visible) });
  });

  app.post(
    '/relays/:relayId/threads',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            starterTransmissionId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
            private: { type: 'boolean' },
            members: { type: 'array', maxItems: 50, items: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = await textRelay(request, reply);
      if (!ctx) return;
      const body = request.body as { name: string; starterTransmissionId?: string; private?: boolean; members?: string[] };
      const isPrivate = !!body.private;
      const perms = ctx.actor.effectivePermissions;
      if (!hasPermission(perms, isPrivate ? PERMISSIONS.CREATE_PRIVATE_THREADS : PERMISSIONS.CREATE_THREADS) || !hasPermission(perms, PERMISSIONS.SEND_IN_THREADS)) {
        return reply.status(403).send({ error: `Transmitter lacks ${isPrivate ? 'CREATE_PRIVATE_THREADS' : 'CREATE_THREADS'} clearance`, code: 'MISSING_PERMISSIONS' });
      }
      // A private thread starts on its own, as on Discord: a transmission's thread is public.
      if (isPrivate && body.starterTransmissionId) return reply.status(400).send({ error: 'Private threads cannot start from a transmission', code: 'PRIVATE_FROM_TRANSMISSION' });
      if (body.starterTransmissionId) {
        const [starter] = await db.select().from(transmissions).where(eq(transmissions.id, body.starterTransmissionId)).limit(1);
        if (!starter || starter.relayId !== ctx.relay.id || starter.threadId) return reply.status(400).send({ error: 'That transmission is not in this relay' });
        const [existing] = await db.select({ id: archivalThreads.id }).from(archivalThreads).where(eq(archivalThreads.starterTransmissionId, starter.id)).limit(1);
        if (existing) return reply.status(409).send({ error: 'That transmission already has a thread', code: 'THREAD_EXISTS', threadId: existing.id });
      }
      const [thread] = await db
        .insert(archivalThreads)
        .values({ relayId: ctx.relay.id, transmitterId: ctx.token.transmitterId, title: body.name.trim(), starterTransmissionId: body.starterTransmissionId ?? null, isPrivate, transmissionCount: 0 })
        .returning();
      if (isPrivate) {
        // The creator, and whoever they named who can see the relay.
        const ids = [...new Set([ctx.token.transmitterId, ...(body.members ?? [])])];
        const allowed: string[] = [];
        for (const id of ids) if (hasPermission(await computeRelayPermissions(db, id, ctx.relay.id), PERMISSIONS.VIEW_RELAY)) allowed.push(id);
        await db.insert(threadMembers).values(allowed.map((transmitterId) => ({ threadId: thread.id, transmitterId })));
      }

      // Without a starter, the relay gets a "started a thread" line pointing at it (not for private ones).
      if (!body.starterTransmissionId && !isPrivate) {
        const [row] = await db
          .insert(transmissions)
          .values({ relayId: ctx.relay.id, transmitterId: ctx.token.transmitterId, content: JSON.stringify({ threadId: thread.id, name: thread.title }), type: 'system_thread' })
          .returning();
        const formatted = await formatTransmission(db, row, ctx.token.transmitterId, { beaconId: ctx.relay.beaconId });
        await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType: 'relay', channelId: ctx.relay.id, transmission: formatted }, { relayId: ctx.relay.id });
      }
      const [summary] = await threadSummaries(db, [thread]);
      await publishGatewayEvent(app, 'THREAD_CREATE', { relayId: ctx.relay.id, thread: summary }, { threadId: thread.id });
      return reply.status(201).send({ thread: summary });
    }
  );

  app.patch(
    '/relays/:relayId/threads/:threadId',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, isLocked: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const ctx = await textRelay(request, reply);
      if (!ctx) return;
      const { threadId } = request.params as { threadId: string };
      const [thread] = await db.select().from(archivalThreads).where(and(eq(archivalThreads.id, threadId), eq(archivalThreads.relayId, ctx.relay.id))).limit(1);
      if (!thread || !(await canSeeThread(db, ctx.token.transmitterId, thread))) return reply.status(404).send({ error: 'Thread not found' });
      const body = request.body as { name?: string; isLocked?: boolean };
      const manager = hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.MANAGE_THREADS);
      // The creator can rename it; locking is for Manage Threads.
      if ((body.name !== undefined && thread.transmitterId !== ctx.token.transmitterId && !manager) || (body.isLocked !== undefined && !manager)) {
        return reply.status(403).send({ error: 'Transmitter lacks MANAGE_THREADS clearance', code: 'MISSING_PERMISSIONS' });
      }
      const [updated] = await db
        .update(archivalThreads)
        .set({ ...(body.name ? { title: body.name.trim() } : {}), ...(body.isLocked !== undefined ? { isLocked: body.isLocked } : {}), updatedAt: new Date() })
        .where(eq(archivalThreads.id, threadId))
        .returning();
      const [summary] = await threadSummaries(db, [updated]);
      await publishGatewayEvent(app, 'THREAD_UPDATE', { relayId: ctx.relay.id, thread: summary }, { threadId: updated.id });
      return reply.send({ thread: summary });
    }
  );

  /** The thread named in the route, if the caller can see it. */
  async function visibleThread(ctx: any, request: any, reply: any) {
    const { threadId } = request.params as { threadId: string };
    const [thread] = await db.select().from(archivalThreads).where(and(eq(archivalThreads.id, threadId), eq(archivalThreads.relayId, ctx.relay.id))).limit(1);
    if (!thread || !(await canSeeThread(db, ctx.token.transmitterId, thread))) return reply.status(404).send({ error: 'Thread not found' }), null;
    return thread;
  }

  app.get('/relays/:relayId/threads/:threadId/members', async (request, reply) => {
    const ctx = await textRelay(request, reply);
    if (!ctx) return;
    const thread = await visibleThread(ctx, request, reply);
    if (!thread) return;
    if (!thread.isPrivate) return reply.send({ members: null });
    const rows = await db.select({ id: threadMembers.transmitterId }).from(threadMembers).where(eq(threadMembers.threadId, thread.id));
    return reply.send({ members: rows.map((r: any) => r.id) });
  });

  app.put('/relays/:relayId/threads/:threadId/members/:userId', async (request, reply) => {
    const ctx = await textRelay(request, reply);
    if (!ctx) return;
    const thread = await visibleThread(ctx, request, reply);
    if (!thread) return;
    if (!thread.isPrivate) return reply.status(400).send({ error: 'Everyone who can see the relay is in a public thread', code: 'NOT_PRIVATE' });
    if (thread.isLocked && !hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.MANAGE_THREADS)) return reply.status(403).send({ error: 'This thread is locked', code: 'THREAD_LOCKED' });
    const { userId } = request.params as { userId: string };
    if (!hasPermission(await computeRelayPermissions(db, userId, ctx.relay.id), PERMISSIONS.VIEW_RELAY)) return reply.status(400).send({ error: 'They cannot see this relay', code: 'CANNOT_VIEW_RELAY' });
    await db.insert(threadMembers).values({ threadId: thread.id, transmitterId: userId }).onConflictDoNothing();
    const [summary] = await threadSummaries(db, [thread]);
    await publishGatewayEvent(app, 'THREAD_CREATE', { relayId: ctx.relay.id, thread: summary }, { transmitterIds: [userId] });
    return reply.send({ added: true });
  });

  app.delete('/relays/:relayId/threads/:threadId/members/:userId', async (request, reply) => {
    const ctx = await textRelay(request, reply);
    if (!ctx) return;
    const thread = await visibleThread(ctx, request, reply);
    if (!thread) return;
    const { userId } = request.params as { userId: string };
    // Anyone may leave; removing someone else is for its creator or Manage Threads.
    const may = userId === ctx.token.transmitterId || thread.transmitterId === ctx.token.transmitterId || hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.MANAGE_THREADS);
    if (!may) return reply.status(403).send({ error: 'Only its creator or Manage Threads can remove members', code: 'MISSING_PERMISSIONS' });
    await db.delete(threadMembers).where(and(eq(threadMembers.threadId, thread.id), eq(threadMembers.transmitterId, userId)));
    await publishGatewayEvent(app, 'THREAD_DELETE', { relayId: ctx.relay.id, threadId: thread.id }, { transmitterIds: [userId] });
    return reply.send({ removed: true });
  });
};
