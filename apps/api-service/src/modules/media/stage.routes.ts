import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, relays, resolveRelayAudience } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { requireSecret } from '@subspace/crypto';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { updateLiveKitParticipant } from './livekit.js';

const LIVEKIT_API_KEY = requireSecret('LIVEKIT_API_KEY', 'subspace_api_key');
const LIVEKIT_API_SECRET = requireSecret('LIVEKIT_API_SECRET', 'subspace_secret_key_frequency');
/** The gateway mirrors who is in which comm-link or stage here (transmitter id -> relay id). */
const VOICE_HASH = 'voice:relay';

/** A live Stage (Discord's stage instance): its topic, who speaks, and raised hands. */
export interface StageState {
  topic: string | null;
  startedAt: string | null;
  startedBy: string | null;
  speakers: string[];
  requests: string[];
}
const key = (relayId: string) => `stage:${relayId}`;
const EMPTY: StageState = { topic: null, startedAt: null, startedBy: null, speakers: [], requests: [] };

export async function readStage(redis: any, relayId: string): Promise<StageState> {
  const raw = redis?.status === 'ready' ? await redis.get(key(relayId)) : null;
  return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
}

/** Stage moderators (Discord's): Manage Relays, Mute Members or Move Members. */
export const isStageModerator = (actor: { isOwner: boolean; effectivePermissions: bigint }) =>
  actor.isOwner || [PERMISSIONS.MANAGE_RELAYS, PERMISSIONS.MUTE_MEMBERS, PERMISSIONS.MOVE_MEMBERS].some((p) => hasPermission(actor.effectivePermissions, p));

/**
 * Stages: a voice relay where speakers talk and everyone else listens.
 *   GET    /relays/:relayId/stage                         state, and whether you moderate it
 *   POST   /relays/:relayId/stage           { topic }     start it (moderators)
 *   PATCH  /relays/:relayId/stage           { topic }     change the topic (moderators)
 *   DELETE /relays/:relayId/stage                         end it: everyone back to the audience
 *   POST   /relays/:relayId/stage/hand      { raised }    Request to Speak (people in it)
 *   PUT    /relays/:relayId/stage/speakers/:userId        make them a speaker (moderators; or yourself as one)
 *   DELETE /relays/:relayId/stage/speakers/:userId        back to the audience (moderators, or yourself)
 */
export const stageRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = () => {
    const r = (app as any).redis;
    return r?.status === 'ready' ? r : null;
  };

  async function context(request: any, reply: any) {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db || !redis()) return reply.status(503).send({ error: 'Stages are unavailable right now' }), null;
    const { relayId } = request.params as { relayId: string };
    const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
    if (!relay || relay.type !== 'stage') return reply.status(404).send({ error: 'Stage not found' }), null;
    const actor = await resolveRelayActorContext(db, token.transmitterId, relay);
    if (!actor || !hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY)) return reply.status(404).send({ error: 'Stage not found' }), null;
    return { me: token.transmitterId as string, relay, actor, moderator: isStageModerator(actor) };
  }

  /** Who is still connected: speakers and hands of people who left fall away. */
  async function present(relayId: string, s: StageState): Promise<StageState> {
    const ids = [...new Set([...s.speakers, ...s.requests])];
    if (!ids.length) return s;
    const where: (string | null)[] = await redis().hmget(VOICE_HASH, ...ids);
    const here = new Set(ids.filter((_, i) => where[i] === relayId));
    return { ...s, speakers: s.speakers.filter((id) => here.has(id)), requests: s.requests.filter((id) => here.has(id)) };
  }
  async function save(relay: any, s: StageState) {
    if (s.startedAt) await redis().set(key(relay.id), JSON.stringify(s), 'EX', 24 * 3600);
    else await redis().del(key(relay.id));
    await publishGatewayEvent(app, 'STAGE_UPDATE', { relayId: relay.id, beaconId: relay.beaconId, stage: s }, { transmitterIds: await resolveRelayAudience(db, relay.id) });
  }
  const livekit = (relayId: string, identity: string, canSpeak: boolean, canHoloCast: boolean) =>
    updateLiveKitParticipant({ apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET, room: relayId, identity, canSpeak, canHoloCast });
  const inStage = async (id: string, relayId: string) => (await redis().hget(VOICE_HASH, id)) === relayId;

  app.get('/relays/:relayId/stage', async (request, reply) => {
    const ctx = await context(request, reply);
    if (!ctx) return;
    return reply.send({ stage: await present(ctx.relay.id, await readStage(redis(), ctx.relay.id)), moderator: ctx.moderator });
  });

  const topicBody = { body: { type: 'object', additionalProperties: false, required: ['topic'], properties: { topic: { type: 'string', minLength: 1, maxLength: 120 } } } };

  app.post('/relays/:relayId/stage', { schema: topicBody }, async (request, reply) => {
    const ctx = await context(request, reply);
    if (!ctx) return;
    if (!ctx.moderator) return reply.status(403).send({ error: 'Only stage moderators can start a Stage', code: 'NOT_STAGE_MODERATOR' });
    const current = await readStage(redis(), ctx.relay.id);
    if (current.startedAt) return reply.status(409).send({ error: 'This Stage is already live', code: 'STAGE_LIVE' });
    // Whoever starts it speaks, if they are in it.
    const speakers = (await inStage(ctx.me, ctx.relay.id)) ? [ctx.me] : [];
    const s: StageState = { topic: (request.body as { topic: string }).topic.trim(), startedAt: new Date().toISOString(), startedBy: ctx.me, speakers, requests: [] };
    if (speakers.length) await livekit(ctx.relay.id, ctx.me, true, ctx.actor.isOwner || hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.BROADCAST_HOLO_CAST));
    await save(ctx.relay, s);
    return reply.status(201).send({ stage: s });
  });

  app.patch('/relays/:relayId/stage', { schema: topicBody }, async (request, reply) => {
    const ctx = await context(request, reply);
    if (!ctx) return;
    if (!ctx.moderator) return reply.status(403).send({ error: 'Only stage moderators can change the topic', code: 'NOT_STAGE_MODERATOR' });
    const s = await present(ctx.relay.id, await readStage(redis(), ctx.relay.id));
    if (!s.startedAt) return reply.status(404).send({ error: 'This Stage is not live', code: 'STAGE_NOT_LIVE' });
    s.topic = (request.body as { topic: string }).topic.trim();
    await save(ctx.relay, s);
    return reply.send({ stage: s });
  });

  app.delete('/relays/:relayId/stage', async (request, reply) => {
    const ctx = await context(request, reply);
    if (!ctx) return;
    if (!ctx.moderator) return reply.status(403).send({ error: 'Only stage moderators can end a Stage', code: 'NOT_STAGE_MODERATOR' });
    const s = await readStage(redis(), ctx.relay.id);
    for (const id of s.speakers) await livekit(ctx.relay.id, id, false, false);
    await save(ctx.relay, { ...EMPTY });
    return reply.send({ stage: EMPTY });
  });

  app.post(
    '/relays/:relayId/stage/hand',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['raised'], properties: { raised: { type: 'boolean' } } } } },
    async (request, reply) => {
      const ctx = await context(request, reply);
      if (!ctx) return;
      if (!(await inStage(ctx.me, ctx.relay.id))) return reply.status(403).send({ error: 'Join the Stage first', code: 'NOT_IN_STAGE' });
      const s = await present(ctx.relay.id, await readStage(redis(), ctx.relay.id));
      if (!s.startedAt) return reply.status(404).send({ error: 'This Stage is not live', code: 'STAGE_NOT_LIVE' });
      const { raised } = request.body as { raised: boolean };
      if (!hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.SPEAK_AUDIO) && !ctx.actor.isOwner) return reply.status(403).send({ error: 'Transmitter lacks SPEAK_AUDIO clearance' });
      s.requests = s.requests.filter((id) => id !== ctx.me);
      if (raised && !s.speakers.includes(ctx.me)) s.requests.push(ctx.me);
      await save(ctx.relay, s);
      return reply.send({ stage: s });
    }
  );

  app.put('/relays/:relayId/stage/speakers/:userId', async (request, reply) => {
    const ctx = await context(request, reply);
    if (!ctx) return;
    const { userId } = request.params as { userId: string };
    if (!ctx.moderator) return reply.status(403).send({ error: 'Only stage moderators can invite speakers', code: 'NOT_STAGE_MODERATOR' });
    const s = await present(ctx.relay.id, await readStage(redis(), ctx.relay.id));
    if (!s.startedAt) return reply.status(404).send({ error: 'This Stage is not live', code: 'STAGE_NOT_LIVE' });
    if (!(await inStage(userId, ctx.relay.id))) return reply.status(400).send({ error: 'They are not in the Stage', code: 'NOT_IN_STAGE' });
    // They still need their own Speak clearance in this relay.
    const target = await resolveRelayActorContext(db, userId, ctx.relay);
    if (!target || (!target.isOwner && !hasPermission(target.effectivePermissions, PERMISSIONS.SPEAK_AUDIO))) {
      return reply.status(403).send({ error: 'They cannot speak in this Stage', code: 'TARGET_CANNOT_SPEAK' });
    }
    if (!s.speakers.includes(userId)) s.speakers.push(userId);
    s.requests = s.requests.filter((id) => id !== userId);
    // LiveKit first: their client starts publishing as soon as it hears it is a speaker.
    await livekit(ctx.relay.id, userId, true, target.isOwner || hasPermission(target.effectivePermissions, PERMISSIONS.BROADCAST_HOLO_CAST));
    await save(ctx.relay, s);
    return reply.send({ stage: s });
  });

  app.delete('/relays/:relayId/stage/speakers/:userId', async (request, reply) => {
    const ctx = await context(request, reply);
    if (!ctx) return;
    const { userId } = request.params as { userId: string };
    if (userId !== ctx.me && !ctx.moderator) return reply.status(403).send({ error: 'Only stage moderators can move others to the audience', code: 'NOT_STAGE_MODERATOR' });
    const s = await readStage(redis(), ctx.relay.id);
    s.speakers = s.speakers.filter((id) => id !== userId);
    if (s.startedAt) await save(ctx.relay, s);
    await livekit(ctx.relay.id, userId, false, false);
    return reply.send({ stage: s });
  });
};
