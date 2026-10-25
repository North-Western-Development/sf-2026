import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, beaconMembers, relays, resolveRelayAudience } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';

/** The gateway mirrors who is in which comm-link here (transmitter id -> relay id). */
const VOICE_HASH = 'voice:relay';
const KINDS = ['watch', 'whiteboard'] as const;
type Kind = (typeof KINDS)[number];
const MAX_STROKES = 2000;
const YOUTUBE = /^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)[\w-]{6,}/;
const VIDEO_FILE = /^https?:\/\/\S+\.(mp4|webm|ogv|mov)(\?\S*)?$/i;

export interface Activity {
  id: string;
  relayId: string;
  beaconId: string;
  kind: Kind;
  hostId: string;
  startedAt: string;
  participants: string[];
  /** Watch Together: what is playing and where, as of `at`. */
  watch?: { url: string; playing: boolean; position: number; at: number };
}

const key = (relayId: string) => `activity:${relayId}`;
const strokesKey = (relayId: string) => `activity:${relayId}:strokes`;
export const isVideoUrl = (url: string) => YOUTUBE.test(url) || VIDEO_FILE.test(url);

/**
 * Activities in comm-links (Discord's, built in rather than from a store): Watch Together and
 * Whiteboard. One per comm-link; only people connected to it can start, join or send to it.
 *   GET  /relays/:relayId/activity                 the running activity, or null
 *   POST /relays/:relayId/activity                 { kind, url? } start one
 *   POST /relays/:relayId/activity/join | leave
 *   POST /relays/:relayId/activity/events          { type, data } to everyone in it
 *   GET  /relays/:relayId/activity/strokes         the whiteboard so far (late joiners)
 *   GET  /users/:id/activity?beaconId=             what a member is in, if they share it
 */
export const activityRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = () => {
    const r = (app as any).redis;
    return r?.status === 'ready' ? r : null;
  };

  async function load(relayId: string): Promise<Activity | null> {
    const raw = await redis()?.get(key(relayId));
    if (!raw) return null;
    const a = JSON.parse(raw) as Activity;
    // Whoever left the comm-link has left the activity; the last one out ends it.
    const where = a.participants.length ? await redis().hmget(VOICE_HASH, ...a.participants) : [];
    const still = a.participants.filter((_, i) => where[i] === relayId);
    if (still.length === a.participants.length) return a;
    if (!still.length) {
      await end(a);
      return null;
    }
    a.participants = still;
    if (!still.includes(a.hostId)) a.hostId = still[0];
    await save(a);
    await announce(a);
    return a;
  }
  const save = (a: Activity) => redis().set(key(a.relayId), JSON.stringify(a), 'EX', 12 * 3600);
  async function end(a: Activity) {
    await redis().del(key(a.relayId), strokesKey(a.relayId));
    await publishGatewayEvent(app, 'ACTIVITY_UPDATE', { relayId: a.relayId, beaconId: a.beaconId, activity: null }, { transmitterIds: await resolveRelayAudience(db, a.relayId) });
  }

  /** Who may see that a participant is in it (Privacy Settings › Share my activity). */
  async function sharers(a: Activity): Promise<string[]> {
    if (!a.participants.length) return [];
    const rows = await db
      .select({ id: beaconMembers.transmitterId, share: beaconMembers.shareActivity })
      .from(beaconMembers)
      .where(and(eq(beaconMembers.beaconId, a.beaconId), inArray(beaconMembers.transmitterId, a.participants)));
    const shown = new Set(rows.filter((r: any) => r.share).map((r: any) => r.id));
    return a.participants.filter((id) => shown.has(id));
  }
  const summary = async (a: Activity) => ({ id: a.id, kind: a.kind, hostId: a.hostId, startedAt: a.startedAt, count: a.participants.length, participants: await sharers(a) });
  async function announce(a: Activity) {
    await publishGatewayEvent(app, 'ACTIVITY_UPDATE', { relayId: a.relayId, beaconId: a.beaconId, activity: await summary(a) }, { transmitterIds: await resolveRelayAudience(db, a.relayId) });
  }

  /** The caller, the comm-link, and whether they are connected to it. */
  async function context(request: any, reply: any, needVoice = true) {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    if (!redis()) return reply.status(503).send({ error: 'Activities need Redis' }), null;
    const { relayId } = request.params as { relayId: string };
    const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
    if (!relay || relay.type !== 'comm_link') return reply.status(404).send({ error: 'Comm-Link not found' }), null;
    const actor = await resolveRelayActorContext(db, token.transmitterId, relay);
    if (!actor || !hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY)) return reply.status(404).send({ error: 'Comm-Link not found' }), null;
    if (needVoice) {
      if (!hasPermission(actor.effectivePermissions, PERMISSIONS.USE_ACTIVITIES)) return reply.status(403).send({ error: 'Transmitter lacks USE_ACTIVITIES clearance', code: 'MISSING_PERMISSIONS' }), null;
      if ((await redis().hget(VOICE_HASH, token.transmitterId)) !== relayId) return reply.status(403).send({ error: 'Join the comm-link first', code: 'NOT_IN_COMM_LINK' }), null;
    }
    return { me: token.transmitterId as string, relay };
  }

  app.get('/relays/:relayId/activity', async (request, reply) => {
    const ctx = await context(request, reply, false);
    if (!ctx) return;
    const a = await load(ctx.relay.id);
    if (!a) return reply.send({ activity: null });
    // People in the activity see all of it; anyone else sees only who shares it.
    if (a.participants.includes(ctx.me)) return reply.send({ activity: { ...a, count: a.participants.length } });
    return reply.send({ activity: await summary(a) });
  });

  app.post(
    '/relays/:relayId/activity',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { type: 'string', enum: [...KINDS] }, url: { type: 'string', maxLength: 500 } } } } },
    async (request, reply) => {
      const ctx = await context(request, reply);
      if (!ctx) return;
      const body = request.body as { kind: Kind; url?: string };
      if (await load(ctx.relay.id)) return reply.status(409).send({ error: 'An activity is already running here', code: 'ACTIVITY_RUNNING' });
      if (body.kind === 'watch' && (!body.url || !isVideoUrl(body.url))) {
        return reply.status(400).send({ error: 'Paste a YouTube link or a link to a video file', code: 'INVALID_VIDEO_URL' });
      }
      const a: Activity = {
        id: randomUUID(),
        relayId: ctx.relay.id,
        beaconId: ctx.relay.beaconId,
        kind: body.kind,
        hostId: ctx.me,
        startedAt: new Date().toISOString(),
        participants: [ctx.me],
        ...(body.kind === 'watch' ? { watch: { url: body.url!, playing: false, position: 0, at: Date.now() } } : {}),
      };
      await save(a);
      await announce(a);
      return reply.status(201).send({ activity: { ...a, count: 1 } });
    }
  );

  app.post('/relays/:relayId/activity/join', async (request, reply) => {
    const ctx = await context(request, reply);
    if (!ctx) return;
    const a = await load(ctx.relay.id);
    if (!a) return reply.status(404).send({ error: 'No activity is running here', code: 'NO_ACTIVITY' });
    if (!a.participants.includes(ctx.me)) {
      a.participants.push(ctx.me);
      await save(a);
      await announce(a);
    }
    return reply.send({ activity: { ...a, count: a.participants.length } });
  });

  app.post('/relays/:relayId/activity/leave', async (request, reply) => {
    const ctx = await context(request, reply, false);
    if (!ctx) return;
    const a = await load(ctx.relay.id);
    if (!a || !a.participants.includes(ctx.me)) return reply.send({ left: true });
    a.participants = a.participants.filter((id) => id !== ctx.me);
    if (!a.participants.length) await end(a);
    else {
      if (a.hostId === ctx.me) a.hostId = a.participants[0];
      await save(a);
      await announce(a);
    }
    return reply.send({ left: true });
  });

  const lastEvent = new Map<string, number[]>();
  app.post(
    '/relays/:relayId/activity/events',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['stroke', 'clear', 'watch'] },
            data: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = await context(request, reply);
      if (!ctx) return;
      const a = await load(ctx.relay.id);
      if (!a || !a.participants.includes(ctx.me)) return reply.status(403).send({ error: 'Join the activity first', code: 'NOT_IN_ACTIVITY' });
      // 30 events a second each is plenty for drawing, and stops floods.
      const now = Date.now();
      const recent = (lastEvent.get(ctx.me) ?? []).filter((t) => now - t < 1000);
      if (recent.length >= 30) return reply.status(429).send({ error: 'Slow down', code: 'ACTIVITY_RATE_LIMIT' });
      lastEvent.set(ctx.me, [...recent, now]);

      const { type, data = {} } = request.body as { type: 'stroke' | 'clear' | 'watch'; data?: any };
      let payload: any;
      if (type === 'stroke') {
        if (a.kind !== 'whiteboard') return reply.status(400).send({ error: 'Not a whiteboard' });
        const points = Array.isArray(data.points) ? data.points.slice(0, 500) : [];
        if (points.length < 2 || !points.every((n: unknown) => typeof n === 'number' && n >= 0 && n <= 1)) return reply.status(400).send({ error: 'A stroke is an even list of 0–1 coordinates' });
        payload = {
          id: typeof data.id === 'string' ? data.id.slice(0, 40) : randomUUID(),
          points,
          color: typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#EEF1FA',
          width: Math.min(24, Math.max(1, Number(data.width) || 3)),
          by: ctx.me,
        };
        await redis().rpush(strokesKey(a.relayId), JSON.stringify(payload));
        await redis().ltrim(strokesKey(a.relayId), -MAX_STROKES, -1);
        await redis().expire(strokesKey(a.relayId), 12 * 3600);
      } else if (type === 'clear') {
        if (a.kind !== 'whiteboard') return reply.status(400).send({ error: 'Not a whiteboard' });
        await redis().del(strokesKey(a.relayId));
        payload = { by: ctx.me };
      } else {
        if (a.kind !== 'watch') return reply.status(400).send({ error: 'Not Watch Together' });
        const url = typeof data.url === 'string' ? data.url : a.watch!.url;
        if (!isVideoUrl(url)) return reply.status(400).send({ error: 'Paste a YouTube link or a link to a video file', code: 'INVALID_VIDEO_URL' });
        a.watch = { url, playing: !!data.playing, position: Math.max(0, Number(data.position) || 0), at: now };
        await save(a);
        payload = { ...a.watch, by: ctx.me };
      }
      await publishGatewayEvent(app, 'ACTIVITY_EVENT', { relayId: a.relayId, activityId: a.id, event: type, data: payload }, { transmitterIds: a.participants });
      return reply.send({ ok: true });
    }
  );

  app.get('/relays/:relayId/activity/strokes', async (request, reply) => {
    const ctx = await context(request, reply, false);
    if (!ctx) return;
    const a = await load(ctx.relay.id);
    if (!a || !a.participants.includes(ctx.me)) return reply.status(403).send({ error: 'Join the activity first', code: 'NOT_IN_ACTIVITY' });
    const raw: string[] = await redis().lrange(strokesKey(a.relayId), 0, -1);
    return reply.send({ strokes: raw.map((s) => JSON.parse(s)) });
  });

  // What a member is in, for their profile (Share my activity / Activity joining).
  app.get('/users/:id/activity', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db || !redis()) return reply.send({ activity: null });
    const { id } = request.params as { id: string };
    const { beaconId } = request.query as { beaconId?: string };
    if (!beaconId) return reply.send({ activity: null });
    const relayId = await redis().hget(VOICE_HASH, id);
    if (!relayId) return reply.send({ activity: null });
    const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
    if (!relay || relay.beaconId !== beaconId) return reply.send({ activity: null });
    const viewer = await resolveRelayActorContext(db, token.transmitterId, relay);
    if (!viewer || !hasPermission(viewer.effectivePermissions, PERMISSIONS.VIEW_RELAY)) return reply.send({ activity: null });
    const a = await load(relayId);
    if (!a || !a.participants.includes(id)) return reply.send({ activity: null });
    const [m] = await db
      .select({ share: beaconMembers.shareActivity, joining: beaconMembers.activityJoining })
      .from(beaconMembers)
      .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, id)))
      .limit(1);
    if (!m?.share && id !== token.transmitterId) return reply.send({ activity: null });
    return reply.send({ activity: { kind: a.kind, relayId, relayName: relay.name, startedAt: a.startedAt, joinable: !!m?.joining && id !== token.transmitterId } });
  });
};
