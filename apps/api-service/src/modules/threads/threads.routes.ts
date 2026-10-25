import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, desc, inArray, sql, archivalThreads, relays, transmissions } from '@subspace/database';
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
 *   GET   /relays/:relayId/threads
 *   POST  /relays/:relayId/threads          { name, starterTransmissionId? }
 *   PATCH /relays/:relayId/threads/:threadId { name?, isLocked? }
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
    const rows = await db.select().from(archivalThreads).where(eq(archivalThreads.relayId, ctx.relay.id)).orderBy(desc(archivalThreads.lastTransmissionAt)).limit(50);
    return reply.send({ threads: await threadSummaries(db, rows) });
  });

  app.post(
    '/relays/:relayId/threads',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, starterTransmissionId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const ctx = await textRelay(request, reply);
      if (!ctx) return;
      if (!hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.CREATE_THREADS) || !hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.SEND_TRANSMISSIONS)) {
        return reply.status(403).send({ error: 'Transmitter lacks CREATE_THREADS clearance' });
      }
      const body = request.body as { name: string; starterTransmissionId?: string };
      if (body.starterTransmissionId) {
        const [starter] = await db.select().from(transmissions).where(eq(transmissions.id, body.starterTransmissionId)).limit(1);
        if (!starter || starter.relayId !== ctx.relay.id || starter.threadId) return reply.status(400).send({ error: 'That transmission is not in this relay' });
        const [existing] = await db.select({ id: archivalThreads.id }).from(archivalThreads).where(eq(archivalThreads.starterTransmissionId, starter.id)).limit(1);
        if (existing) return reply.status(409).send({ error: 'That transmission already has a thread', code: 'THREAD_EXISTS', threadId: existing.id });
      }
      const [thread] = await db
        .insert(archivalThreads)
        .values({ relayId: ctx.relay.id, transmitterId: ctx.token.transmitterId, title: body.name.trim(), starterTransmissionId: body.starterTransmissionId ?? null, transmissionCount: 0 })
        .returning();

      // Without a starter, the relay gets a "started a thread" line pointing at it.
      if (!body.starterTransmissionId) {
        const [row] = await db
          .insert(transmissions)
          .values({ relayId: ctx.relay.id, transmitterId: ctx.token.transmitterId, content: JSON.stringify({ threadId: thread.id, name: thread.title }), type: 'system_thread' })
          .returning();
        const formatted = await formatTransmission(db, row, ctx.token.transmitterId, { beaconId: ctx.relay.beaconId });
        await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType: 'relay', channelId: ctx.relay.id, transmission: formatted }, { relayId: ctx.relay.id });
      }
      const [summary] = await threadSummaries(db, [thread]);
      await publishGatewayEvent(app, 'THREAD_CREATE', { relayId: ctx.relay.id, thread: summary }, { relayId: ctx.relay.id });
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
      if (!thread) return reply.status(404).send({ error: 'Thread not found' });
      const body = request.body as { name?: string; isLocked?: boolean };
      const manager = hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS);
      // The creator can rename it; locking is for moderators.
      if ((body.name !== undefined && thread.transmitterId !== ctx.token.transmitterId && !manager) || (body.isLocked !== undefined && !manager)) {
        return reply.status(403).send({ error: 'Transmitter lacks MANAGE_TRANSMISSIONS clearance' });
      }
      const [updated] = await db
        .update(archivalThreads)
        .set({ ...(body.name ? { title: body.name.trim() } : {}), ...(body.isLocked !== undefined ? { isLocked: body.isLocked } : {}), updatedAt: new Date() })
        .where(eq(archivalThreads.id, threadId))
        .returning();
      const [summary] = await threadSummaries(db, [updated]);
      await publishGatewayEvent(app, 'THREAD_UPDATE', { relayId: ctx.relay.id, thread: summary }, { relayId: ctx.relay.id });
      return reply.send({ thread: summary });
    }
  );
};
