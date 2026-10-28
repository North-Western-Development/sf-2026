import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, transmissions, pollVotes, type TransmissionPoll } from '@subspace/database';
import { formatPoll, pollEnded, pollResults } from '../../lib/polls.js';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { CHANNEL_TYPES, loadChannel, checkChannelAccess, audienceForChannel } from '../../lib/channels.js';

/**
 * Polls (Discord's):
 *   PUT  /channels/:type/:id/transmissions/:transmissionId/poll/votes  { answerIds } (empty to remove)
 *   POST /channels/:type/:id/transmissions/:transmissionId/poll/end     its author or Manage Transmissions
 * Anyone who can see the channel can vote until it ends. POLL_UPDATE carries the new counts.
 */
export const pollRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function load(request: any, reply: any) {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    const { channelType, channelId, transmissionId } = request.params as { channelType: string; channelId: string; transmissionId: string };
    if (!(CHANNEL_TYPES as string[]).includes(channelType)) return reply.status(404).send({ error: 'Channel not found' }), null;
    const channel = await loadChannel(db, channelType, channelId);
    if (!channel) return reply.status(404).send({ error: 'Channel not found or not visible' }), null;
    const access = await checkChannelAccess(db, channel, token.transmitterId, 'view');
    if (!access.allowed) return reply.status(access.status).send({ error: access.error }), null;
    const [row] = await db.select().from(transmissions).where(eq(transmissions.id, transmissionId)).limit(1);
    const column = { relay: 'relayId', thread: 'threadId', link: 'p2pLinkId', mesh: 'meshId' }[channelType as 'relay'];
    if (!row || row[column] !== channelId || !row.poll) return reply.status(404).send({ error: 'Poll not found' }), null;
    return { me: token.transmitterId as string, channel, access, row };
  }

  async function announce(ctx: any) {
    const r = await pollResults(db, ctx.row.id);
    const [fresh] = await db.select({ poll: transmissions.poll }).from(transmissions).where(eq(transmissions.id, ctx.row.id)).limit(1);
    await publishGatewayEvent(
      app,
      'POLL_UPDATE',
      { channelType: ctx.channel.channelType, channelId: ctx.channel.channelId, transmissionId: ctx.row.id, counts: r.counts, totalVoters: r.totalVoters, ended: pollEnded(fresh.poll) },
      audienceForChannel(ctx.channel)
    );
  }

  const params = {
    type: 'object',
    properties: { channelType: { type: 'string' }, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, transmissionId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
  };

  app.put(
    '/channels/:channelType/:channelId/transmissions/:transmissionId/poll/votes',
    { schema: { params, body: { type: 'object', additionalProperties: false, required: ['answerIds'], properties: { answerIds: { type: 'array', maxItems: 10, items: { type: 'integer', minimum: 1, maximum: 10 } } } } } },
    async (request, reply) => {
      const ctx = await load(request, reply);
      if (!ctx) return;
      const poll = ctx.row.poll as TransmissionPoll;
      if (pollEnded(poll)) return reply.status(400).send({ error: 'This poll has ended', code: 'POLL_ENDED' });
      const answerIds = [...new Set((request.body as { answerIds: number[] }).answerIds)];
      if (answerIds.some((id) => !poll.answers.some((a) => a.id === id))) return reply.status(400).send({ error: 'Unknown answer', code: 'INVALID_ANSWER' });
      if (answerIds.length > 1 && !poll.allowMultiselect) return reply.status(400).send({ error: 'Pick one answer', code: 'SINGLE_ANSWER' });
      await db.delete(pollVotes).where(and(eq(pollVotes.transmissionId, ctx.row.id), eq(pollVotes.transmitterId, ctx.me)));
      if (answerIds.length) await db.insert(pollVotes).values(answerIds.map((answerId) => ({ transmissionId: ctx.row.id, answerId, transmitterId: ctx.me })));
      await announce(ctx);
      return reply.send({ poll: await formatPoll(db, ctx.row, ctx.me) });
    }
  );

  app.post('/channels/:channelType/:channelId/transmissions/:transmissionId/poll/end', { schema: { params } }, async (request, reply) => {
    const ctx = await load(request, reply);
    if (!ctx) return;
    const moderator = !!ctx.access.actorContext && hasPermission(ctx.access.actorContext.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS);
    if (ctx.row.transmitterId !== ctx.me && !moderator) return reply.status(403).send({ error: 'Only its author can end the poll', code: 'MISSING_PERMISSIONS' });
    const poll = { ...(ctx.row.poll as TransmissionPoll), endedAt: new Date().toISOString() };
    await db.update(transmissions).set({ poll }).where(eq(transmissions.id, ctx.row.id));
    ctx.row.poll = poll;
    await announce(ctx);
    return reply.send({ poll: await formatPoll(db, ctx.row, ctx.me) });
  });
};
