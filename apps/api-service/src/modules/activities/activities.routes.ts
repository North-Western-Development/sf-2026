import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, inArray, beaconMembers, relays, resolveRelayAudience, newSnowflake, oauthGrants } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { grantCovers, loadActivityApp, mayLaunch, mintActivityCode, publicActivityApp, publicProfiles, type ActivityAppInfo } from '../../lib/app-activities.js';
import { SCOPES } from '../oauth/oauth.routes.js';

/** The gateway mirrors who is in which comm-link here (transmitter id -> relay id). */
const VOICE_HASH = 'voice:relay';
/** Built in, and 'app': a developer's Activity (app-activities.routes.ts, lib/app-activities.ts). */
const KINDS = ['watch', 'whiteboard', 'app'] as const;
type Kind = (typeof KINDS)[number];
const MAX_STROKES = 2000;
const YOUTUBE = /^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)[\w-]{6,}/;
const VIDEO_FILE = /^https:\/\/\S+\.(mp4|webm|ogv|mov)(\?\S*)?$/i;

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
  /** A custom Activity: whose, and the page participants load (looked up again on every join). */
  app?: { id: string; name: string; iconUrl: string | null; developer: string; url: string; origin: string; maxParticipants: number; approved: boolean };
}

/** Relayed between a custom Activity's participants (sdk.broadcast): JSON, this big at most. */
const MAX_MESSAGE_BYTES = 4096;
const appRef = (info: ActivityAppInfo): NonNullable<Activity['app']> => {
  const { description: _d, ...rest } = publicActivityApp(info, true);
  return { ...rest, url: info.url };
};

const listKey = (relayId: string) => `activities:${relayId}`;
const strokesKey = (activityId: string) => `activity:${activityId}:strokes`;
const MAX_PER_COMM_LINK = 10;
export const isVideoUrl = (url: string) => YOUTUBE.test(url) || VIDEO_FILE.test(url);

/**
 * Activities in comm-links (Discord's, built in rather than from a store): Watch Together and
 * Whiteboard. A comm-link can run several at once, even of the same kind; each person is in at
 * most one. Only people connected to the comm-link can start, join or send to them.
 *   GET  /relays/:relayId/activities                      the running activities
 *   POST /relays/:relayId/activities                      { kind, url? } start one
 *   POST /relays/:relayId/activities/:id/join | leave
 *   POST /relays/:relayId/activities/:id/events           { type, data } to everyone in it
 *   GET  /relays/:relayId/activities/:id/strokes          the whiteboard so far (late joiners)
 *   GET  /users/:id/activity?beaconId=                    what a member is in, if they share it
 *   POST /relays/:relayId/activities/:id/authorize        { scopes, consent? } an OAuth2 code for a custom Activity
 *
 * kind 'app' is a developer's Activity: start it with { kind: 'app', appId }. Until staff approve
 * it only the app's team can start or join it. Its participants get ACTIVITY_EVENT 'participants'
 * (with public profiles) and ACTIVITY_MESSAGE (sdk.broadcast: event type 'message').
 */
export const activityRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = () => {
    const r = (app as any).redis;
    return r?.status === 'ready' ? r : null;
  };

  /** Every activity in the comm-link, without the people who have left it since. */
  async function loadAll(relayId: string): Promise<Activity[]> {
    const raw: Record<string, string> = await redis()?.hgetall(listKey(relayId));
    const all = Object.values(raw ?? {}).map((v) => JSON.parse(v) as Activity);
    const people = [...new Set(all.flatMap((a) => a.participants))];
    const where = people.length ? await redis().hmget(VOICE_HASH, ...people) : [];
    const inLink = new Set(people.filter((_, i) => where[i] === relayId));
    const live: Activity[] = [];
    for (const a of all) {
      // Whoever left the comm-link has left the activity; the last one out ends it.
      const still = a.participants.filter((id) => inLink.has(id));
      if (still.length === a.participants.length) live.push(a);
      else if (!still.length) await end(a);
      else {
        a.participants = still;
        if (!still.includes(a.hostId)) a.hostId = still[0];
        await save(a);
        await announce(a);
        live.push(a);
      }
    }
    return live.sort((x, y) => x.startedAt.localeCompare(y.startedAt));
  }
  async function load(relayId: string, activityId: string) {
    return (await loadAll(relayId)).find((a) => a.id === activityId) ?? null;
  }
  const save = (a: Activity) => redis().multi().hset(listKey(a.relayId), a.id, JSON.stringify(a)).expire(listKey(a.relayId), 12 * 3600).exec();
  async function end(a: Activity) {
    await redis().hdel(listKey(a.relayId), a.id);
    await redis().del(strokesKey(a.id));
    await publishGatewayEvent(app, 'ACTIVITY_UPDATE', { relayId: a.relayId, beaconId: a.beaconId, activityId: a.id, activity: null }, { transmitterIds: await resolveRelayAudience(db, a.relayId) });
  }
  async function leave(a: Activity, me: string) {
    a.participants = a.participants.filter((id) => id !== me);
    if (!a.participants.length) return end(a);
    if (a.hostId === me) a.hostId = a.participants[0];
    await save(a);
    await announce(a);
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
  /** Which app a custom Activity is, for the launcher, banners, profiles and the privacy notice (no URL). */
  const appSummary = (a: Activity) => (a.app ? { app: { id: a.app.id, name: a.app.name, iconUrl: a.app.iconUrl, developer: a.app.developer, approved: a.app.approved, origin: new URL(a.app.url).origin } } : {});
  const summary = async (a: Activity) => ({ id: a.id, kind: a.kind, hostId: a.hostId, startedAt: a.startedAt, count: a.participants.length, participants: await sharers(a), ...appSummary(a) });
  /** People in an activity see all of it (a custom one with everyone's public profile); anyone else sees only who shares it. */
  const view = async (a: Activity, me: string) =>
    a.participants.includes(me) ? { ...a, count: a.participants.length, ...(a.kind === 'app' ? { people: await publicProfiles(db, a.participants) } : {}) } : summary(a);
  async function announce(a: Activity) {
    await publishGatewayEvent(app, 'ACTIVITY_UPDATE', { relayId: a.relayId, beaconId: a.beaconId, activityId: a.id, activity: await summary(a) }, { transmitterIds: await resolveRelayAudience(db, a.relayId) });
    // A custom Activity is told everyone in it (the summary names only those who share their activity).
    if (a.kind === 'app') {
      await publishGatewayEvent(
        app,
        'ACTIVITY_EVENT',
        { relayId: a.relayId, activityId: a.id, event: 'participants', data: { hostId: a.hostId, participants: a.participants, people: await publicProfiles(db, a.participants) } },
        { transmitterIds: a.participants }
      );
    }
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
  /** The activity named in the route, or a 404 already sent. */
  async function activityOf(request: any, reply: any, relayId: string) {
    const a = await load(relayId, (request.params as { activityId: string }).activityId);
    if (!a) reply.status(404).send({ error: 'That activity has ended', code: 'NO_ACTIVITY' });
    return a;
  }

  app.get('/relays/:relayId/activities', async (request, reply) => {
    const ctx = await context(request, reply, false);
    if (!ctx) return;
    const all = await loadAll(ctx.relay.id);
    return reply.send({ activities: await Promise.all(all.map((a) => view(a, ctx.me))) });
  });

  app.post(
    '/relays/:relayId/activities',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { type: 'string', enum: [...KINDS] }, url: { type: 'string', maxLength: 500 }, appId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
      },
    },
    async (request, reply) => {
      const ctx = await context(request, reply);
      if (!ctx) return;
      const body = request.body as { kind: Kind; url?: string; appId?: string };
      if (body.kind === 'watch' && (!body.url || !isVideoUrl(body.url))) {
        return reply.status(400).send({ error: 'Paste a YouTube link or a link to a video file', code: 'INVALID_VIDEO_URL' });
      }
      let info: ActivityAppInfo | null = null;
      if (body.kind === 'app') {
        info = body.appId ? await loadActivityApp(db, body.appId) : null;
        if (!info) return reply.status(404).send({ error: 'Unknown activity', code: 'UNKNOWN_ACTIVITY' });
        if (!(await mayLaunch(db, info, ctx.me))) return reply.status(403).send({ error: 'This activity has not been approved yet', code: 'ACTIVITY_NOT_APPROVED' });
      }
      const all = await loadAll(ctx.relay.id);
      if (all.length >= MAX_PER_COMM_LINK) return reply.status(409).send({ error: `A comm-link can run ${MAX_PER_COMM_LINK} activities at once`, code: 'ACTIVITY_LIMIT' });
      // One activity per person: starting a new one leaves the old.
      for (const other of all.filter((x) => x.participants.includes(ctx.me))) await leave(other, ctx.me);
      const a: Activity = {
        id: newSnowflake(),
        relayId: ctx.relay.id,
        beaconId: ctx.relay.beaconId,
        kind: body.kind,
        hostId: ctx.me,
        startedAt: new Date().toISOString(),
        participants: [ctx.me],
        ...(body.kind === 'watch' ? { watch: { url: body.url!, playing: false, position: 0, at: Date.now() } } : {}),
        ...(info ? { app: appRef(info) } : {}),
      };
      await save(a);
      await announce(a);
      return reply.status(201).send({ activity: await view(a, ctx.me) });
    }
  );

  app.post('/relays/:relayId/activities/:activityId/join', async (request, reply) => {
    const ctx = await context(request, reply);
    if (!ctx) return;
    const a = await activityOf(request, reply, ctx.relay.id);
    if (!a) return;
    if (a.kind === 'app' && !a.participants.includes(ctx.me)) {
      // Looked up again: it may have been deleted, re-pointed or lost its approval since it started.
      const info = await loadActivityApp(db, a.app!.id);
      if (!info) return reply.status(404).send({ error: 'That activity is no longer available', code: 'UNKNOWN_ACTIVITY' });
      if (!(await mayLaunch(db, info, ctx.me))) return reply.status(403).send({ error: 'This activity has not been approved yet', code: 'ACTIVITY_NOT_APPROVED' });
      if (a.participants.length >= info.maxParticipants) return reply.status(409).send({ error: 'This activity is full', code: 'ACTIVITY_FULL' });
      a.app = appRef(info);
    }
    if (!a.participants.includes(ctx.me)) {
      for (const other of (await loadAll(ctx.relay.id)).filter((x) => x.id !== a.id && x.participants.includes(ctx.me))) await leave(other, ctx.me);
      a.participants.push(ctx.me);
      await save(a);
      await announce(a);
    }
    return reply.send({ activity: await view(a, ctx.me) });
  });

  app.post('/relays/:relayId/activities/:activityId/leave', async (request, reply) => {
    const ctx = await context(request, reply, false);
    if (!ctx) return;
    const a = await load(ctx.relay.id, (request.params as { activityId: string }).activityId);
    if (a?.participants.includes(ctx.me)) await leave(a, ctx.me);
    return reply.send({ left: true });
  });

  const lastEvent = new Map<string, number[]>();
  app.post(
    '/relays/:relayId/activities/:activityId/events',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['stroke', 'clear', 'watch', 'message'] },
            data: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = await context(request, reply);
      if (!ctx) return;
      const a = await activityOf(request, reply, ctx.relay.id);
      if (!a) return;
      if (!a.participants.includes(ctx.me)) return reply.status(403).send({ error: 'Join the activity first', code: 'NOT_IN_ACTIVITY' });
      // 30 events a second each is plenty for drawing, and stops floods.
      const now = Date.now();
      const recent = (lastEvent.get(ctx.me) ?? []).filter((t) => now - t < 1000);
      if (recent.length >= 30) return reply.status(429).send({ error: 'Slow down', code: 'ACTIVITY_RATE_LIMIT' });
      lastEvent.set(ctx.me, [...recent, now]);

      const { type, data = {} } = request.body as { type: 'stroke' | 'clear' | 'watch' | 'message'; data?: any };
      let payload: any;
      if (type === 'message') {
        // sdk.broadcast: relayed as is to the others in this custom Activity, never stored.
        if (a.kind !== 'app') return reply.status(400).send({ error: 'Only custom activities relay messages' });
        if (!('payload' in data)) return reply.status(400).send({ error: 'data.payload is required' });
        if (Buffer.byteLength(JSON.stringify(data.payload) ?? '') > MAX_MESSAGE_BYTES) {
          return reply.status(413).send({ error: `Messages are at most ${MAX_MESSAGE_BYTES} bytes of JSON`, code: 'ACTIVITY_MESSAGE_TOO_LARGE' });
        }
        const others = a.participants.filter((id) => id !== ctx.me);
        if (others.length) await publishGatewayEvent(app, 'ACTIVITY_MESSAGE', { relayId: a.relayId, activityId: a.id, from: ctx.me, payload: data.payload }, { transmitterIds: others });
        return reply.send({ ok: true });
      }
      if (type === 'stroke') {
        if (a.kind !== 'whiteboard') return reply.status(400).send({ error: 'Not a whiteboard' });
        const points = Array.isArray(data.points) ? data.points.slice(0, 500) : [];
        if (points.length < 2 || !points.every((n: unknown) => typeof n === 'number' && n >= 0 && n <= 1)) return reply.status(400).send({ error: 'A stroke is an even list of 0–1 coordinates' });
        payload = {
          id: typeof data.id === 'string' ? data.id.slice(0, 40) : newSnowflake(),
          points,
          color: typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#EEF1FA',
          width: Math.min(24, Math.max(1, Number(data.width) || 3)),
          by: ctx.me,
        };
        await redis().rpush(strokesKey(a.id), JSON.stringify(payload));
        await redis().ltrim(strokesKey(a.id), -MAX_STROKES, -1);
        await redis().expire(strokesKey(a.id), 12 * 3600);
      } else if (type === 'clear') {
        if (a.kind !== 'whiteboard') return reply.status(400).send({ error: 'Not a whiteboard' });
        await redis().del(strokesKey(a.id));
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

  /**
   * sdk.authorize(): an OAuth2 authorization code for the custom Activity I am in, for its app and
   * me. The client asks me first (an in-app consent prompt) unless I already granted these
   * scopes: without `consent` this answers CONSENT_REQUIRED so it knows to. The code goes to the
   * frame, whose backend redeems it at /oauth2/token with its client secret (and no redirect_uri).
   */
  app.post(
    '/relays/:relayId/activities/:activityId/authorize',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['scopes'],
          properties: { scopes: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', maxLength: 40 } }, consent: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const ctx = await context(request, reply);
      if (!ctx) return;
      const a = await activityOf(request, reply, ctx.relay.id);
      if (!a) return;
      if (a.kind !== 'app' || !a.app) return reply.status(400).send({ error: 'Only custom activities can ask for authorization' });
      if (!a.participants.includes(ctx.me)) return reply.status(403).send({ error: 'Join the activity first', code: 'NOT_IN_ACTIVITY' });
      const body = request.body as { scopes: string[]; consent?: boolean };
      const scopes = [...new Set(body.scopes)];
      if (scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) return reply.status(400).send({ error: 'Unknown scope', code: 'INVALID_SCOPE' });
      // Ten a minute each: a frame cannot spin codes (or prompts) in a loop.
      const limitKey = `activity:authorize:${ctx.me}`;
      const n = await redis().incr(limitKey);
      if (n === 1) await redis().expire(limitKey, 60);
      if (n > 10) return reply.status(429).send({ error: 'Slow down', code: 'ACTIVITY_RATE_LIMIT' });
      const info = await loadActivityApp(db, a.app.id);
      if (!info || !(await mayLaunch(db, info, ctx.me))) return reply.status(403).send({ error: 'This activity has not been approved yet', code: 'ACTIVITY_NOT_APPROVED' });
      if (!body.consent && !(await grantCovers(db, info.id, ctx.me, scopes))) return reply.status(409).send({ error: 'Ask the person first', code: 'CONSENT_REQUIRED' });
      const [existing] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.appId, info.id), eq(oauthGrants.transmitterId, ctx.me))).limit(1);
      if (existing) await db.update(oauthGrants).set({ scopes: [...new Set([...existing.scopes, ...scopes])] }).where(eq(oauthGrants.id, existing.id));
      else await db.insert(oauthGrants).values({ appId: info.id, transmitterId: ctx.me, scopes });
      const code = await mintActivityCode(redis(), { appId: info.id, transmitterId: ctx.me, scopes, activityId: a.id });
      return reply.header('cache-control', 'no-store').send({ code, scopes });
    }
  );

  app.get('/relays/:relayId/activities/:activityId/strokes', async (request, reply) => {
    const ctx = await context(request, reply, false);
    if (!ctx) return;
    const a = await activityOf(request, reply, ctx.relay.id);
    if (!a) return;
    if (!a.participants.includes(ctx.me)) return reply.status(403).send({ error: 'Join the activity first', code: 'NOT_IN_ACTIVITY' });
    const raw: string[] = await redis().lrange(strokesKey(a.id), 0, -1);
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
    const a = (await loadAll(relayId)).find((x) => x.participants.includes(id));
    if (!a) return reply.send({ activity: null });
    const [m] = await db
      .select({ share: beaconMembers.shareActivity, joining: beaconMembers.activityJoining })
      .from(beaconMembers)
      .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, id)))
      .limit(1);
    if (!m?.share && id !== token.transmitterId) return reply.send({ activity: null });
    return reply.send({
      activity: { id: a.id, kind: a.kind, relayId, relayName: relay.name, startedAt: a.startedAt, joinable: !!m?.joining && id !== token.transmitterId, ...appSummary(a) },
    });
  });
};
