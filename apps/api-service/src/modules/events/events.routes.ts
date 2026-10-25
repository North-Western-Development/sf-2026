import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, asc, eq, inArray, count, beaconEvents, eventInterests, relays, transmitters } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { validateMediaUrl } from '../../lib/media.js';

const STATUSES = ['scheduled', 'active', 'completed', 'canceled'] as const;
type Status = (typeof STATUSES)[number];
/** Allowed status moves: the host starts and ends; scheduled events can be canceled. */
const NEXT: Record<Status, Status[]> = { scheduled: ['active', 'canceled'], active: ['completed'], completed: [], canceled: [] };

const userRef = { id: transmitters.id, username: transmitters.username, discriminator: transmitters.discriminator, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl };

/**
 * Scheduled events (Discord's Events).
 *   GET    /api/v1/beacons/:id/events
 *   POST   /api/v1/beacons/:id/events                     (CREATE_EVENTS)
 *   PATCH  /api/v1/beacons/:id/events/:eventId            (own with CREATE_EVENTS, or MANAGE_EVENTS)
 *   DELETE /api/v1/beacons/:id/events/:eventId            (same)
 *   PUT    /api/v1/beacons/:id/events/:eventId/interest   / DELETE
 *   GET    /api/v1/beacons/:id/events/:eventId/interested
 */
export const eventRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function member(request: any, reply: any) {
    const token = extractAuthToken(request);
    if (!token) return void reply.status(401).send({ error: 'Authentication required' });
    if (!db) return void reply.status(503).send({ error: 'Database service unavailable' });
    const { id: beaconId } = request.params as { id: string };
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return void reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    return { beaconId, me: token.transmitterId, perms: actor.effectivePermissions };
  }

  /** Events past their end time count as completed even before anyone ends them. */
  const effectiveStatus = (e: any): Status => (e.status !== 'canceled' && e.endAt && new Date(e.endAt).getTime() < Date.now() ? 'completed' : e.status);

  async function serialize(rows: any[], viewer?: string) {
    if (!rows.length) return [];
    const ids = rows.map((e) => e.id);
    const counts = await db.select({ eventId: eventInterests.eventId, n: count() }).from(eventInterests).where(inArray(eventInterests.eventId, ids)).groupBy(eventInterests.eventId);
    const mine = viewer
      ? new Set((await db.select({ eventId: eventInterests.eventId }).from(eventInterests).where(and(inArray(eventInterests.eventId, ids), eq(eventInterests.transmitterId, viewer)))).map((r: any) => r.eventId))
      : new Set();
    const creatorIds = [...new Set(rows.map((e) => e.creatorId).filter(Boolean))] as string[];
    const creators = creatorIds.length ? await db.select(userRef).from(transmitters).where(inArray(transmitters.id, creatorIds)) : [];
    const byId = new Map(creators.map((c: any) => [c.id, c]));
    const n = new Map(counts.map((c: any) => [c.eventId, Number(c.n)]));
    return rows.map((e) => ({
      id: e.id,
      beaconId: e.beaconId,
      name: e.name,
      description: e.description,
      locationType: e.locationType,
      relayId: e.relayId,
      location: e.location,
      coverUrl: e.coverUrl,
      startAt: e.startAt,
      endAt: e.endAt,
      status: effectiveStatus(e),
      creator: e.creatorId ? byId.get(e.creatorId) ?? null : null,
      interestedCount: n.get(e.id) ?? 0,
      ...(viewer ? { meInterested: mine.has(e.id) } : {}),
    }));
  }

  /** Validates create/edit input; returns the columns to write or an error message. */
  async function parse(beaconId: string, caller: string, body: any, existing?: any): Promise<{ values: Record<string, unknown> } | { error: string }> {
    const v: Record<string, unknown> = {};
    const has = (k: string) => body && Object.prototype.hasOwnProperty.call(body, k);
    if (!existing || has('name')) {
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) return { error: 'Give the event a topic of 1 to 100 characters' };
      v.name = name;
    }
    if (has('description')) {
      const d = body.description == null ? null : String(body.description).trim();
      if (d && d.length > 1000) return { error: 'Description can be at most 1,000 characters' };
      v.description = d || null;
    }
    const locationType = has('locationType') ? body.locationType : existing?.locationType;
    if (locationType !== 'comm_link' && locationType !== 'external') return { error: 'Pick a Comm-Link or somewhere else' };
    v.locationType = locationType;
    if (locationType === 'comm_link') {
      const relayId = has('relayId') ? body.relayId : existing?.relayId;
      const [relay] = relayId ? await db.select().from(relays).where(and(eq(relays.id, relayId), eq(relays.beaconId, beaconId))).limit(1) : [];
      if (!relay || relay.type !== 'comm_link') return { error: 'Pick a Comm-Link in this beacon' };
      v.relayId = relay.id;
      v.location = null;
    } else {
      const location = (has('location') ? body.location : existing?.location)?.toString().trim();
      if (!location || location.length > 100) return { error: 'Say where the event is (up to 100 characters)' };
      v.location = location;
      v.relayId = null;
    }
    if (has('coverUrl')) {
      if (body.coverUrl && !(await validateMediaUrl(db, caller, body.coverUrl, ['banner', 'beacon_banner']))) return { error: 'Cover image must be an uploaded image' };
      v.coverUrl = body.coverUrl || null;
    }
    const start = has('startAt') ? new Date(body.startAt) : existing ? new Date(existing.startAt) : new Date(NaN);
    if (Number.isNaN(start.getTime())) return { error: 'Pick a start date and time' };
    if (has('startAt') && start.getTime() < Date.now() - 60_000 && existing?.status !== 'active') return { error: 'The start time is in the past' };
    v.startAt = start;
    const endRaw = has('endAt') ? body.endAt : existing?.endAt;
    const end = endRaw ? new Date(endRaw) : null;
    if (end && (Number.isNaN(end.getTime()) || end <= start)) return { error: 'The end time must be after the start' };
    if (!end && locationType === 'external') return { error: 'Events somewhere else need an end time' };
    v.endAt = end;
    return { values: v };
  }

  const canEdit = (ctx: { me: string; perms: bigint }, e: any) =>
    hasPermission(ctx.perms, PERMISSIONS.MANAGE_EVENTS) || (e.creatorId === ctx.me && hasPermission(ctx.perms, PERMISSIONS.CREATE_EVENTS));

  async function eventIn(beaconId: string, eventId: string) {
    const [e] = await db.select().from(beaconEvents).where(and(eq(beaconEvents.id, eventId), eq(beaconEvents.beaconId, beaconId))).limit(1);
    return e;
  }
  const broadcast = async (beaconId: string, row: any) => {
    const [event] = await serialize([row]);
    await publishGatewayEvent(app, 'EVENT_UPSERT', { beaconId, event }, { beaconId });
  };

  app.get('/:id/events', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const rows = await db.select().from(beaconEvents).where(and(eq(beaconEvents.beaconId, ctx.beaconId), inArray(beaconEvents.status, ['scheduled', 'active']))).orderBy(asc(beaconEvents.startAt));
    const events = (await serialize(rows, ctx.me)).filter((e) => e.status === 'scheduled' || e.status === 'active');
    return reply.send({ events });
  });

  app.post('/:id/events', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    if (!hasPermission(ctx.perms, PERMISSIONS.CREATE_EVENTS) && !hasPermission(ctx.perms, PERMISSIONS.MANAGE_EVENTS)) {
      return reply.status(403).send({ error: 'Creating events needs CREATE_EVENTS' });
    }
    const parsed = await parse(ctx.beaconId, ctx.me, request.body);
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
    const [row] = await db.insert(beaconEvents).values({ ...parsed.values, beaconId: ctx.beaconId, creatorId: ctx.me, status: 'scheduled' }).returning();
    // The host is interested in their own event.
    await db.insert(eventInterests).values({ eventId: row.id, transmitterId: ctx.me }).onConflictDoNothing();
    await broadcast(ctx.beaconId, row);
    const [event] = await serialize([row], ctx.me);
    return reply.status(201).send({ event });
  });

  app.patch('/:id/events/:eventId', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const e = await eventIn(ctx.beaconId, (request.params as any).eventId);
    if (!e) return reply.status(404).send({ error: 'Event not found' });
    if (!canEdit(ctx, e)) return reply.status(403).send({ error: 'You cannot edit this event' });
    const body = (request.body as any) ?? {};
    const values: Record<string, unknown> = {};
    const fields = ['name', 'description', 'locationType', 'relayId', 'location', 'coverUrl', 'startAt', 'endAt'];
    if (fields.some((f) => Object.prototype.hasOwnProperty.call(body, f))) {
      const parsed = await parse(ctx.beaconId, ctx.me, body, e);
      if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
      Object.assign(values, parsed.values);
    }
    if (body.status !== undefined) {
      const current = effectiveStatus(e);
      if (!NEXT[current].includes(body.status)) return reply.status(400).send({ error: `A ${current} event cannot become ${body.status}` });
      values.status = body.status;
      // Starting early moves the start time to now.
      if (body.status === 'active' && new Date(e.startAt).getTime() > Date.now()) values.startAt = new Date();
      if (body.status === 'completed' && (!e.endAt || new Date(e.endAt).getTime() > Date.now())) values.endAt = new Date();
    }
    if (!Object.keys(values).length) return reply.status(400).send({ error: 'Nothing to change' });
    const [row] = await db.update(beaconEvents).set(values).where(eq(beaconEvents.id, e.id)).returning();
    await broadcast(ctx.beaconId, row);
    const [event] = await serialize([row], ctx.me);
    return reply.send({ event });
  });

  app.delete('/:id/events/:eventId', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const e = await eventIn(ctx.beaconId, (request.params as any).eventId);
    if (!e) return reply.status(404).send({ error: 'Event not found' });
    if (!canEdit(ctx, e)) return reply.status(403).send({ error: 'You cannot delete this event' });
    await db.delete(beaconEvents).where(eq(beaconEvents.id, e.id));
    await publishGatewayEvent(app, 'EVENT_DELETE', { beaconId: ctx.beaconId, eventId: e.id }, { beaconId: ctx.beaconId });
    return reply.status(204).send();
  });

  const interest = (on: boolean) => async (request: any, reply: any) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const e = await eventIn(ctx.beaconId, request.params.eventId);
    if (!e) return reply.status(404).send({ error: 'Event not found' });
    if (on) await db.insert(eventInterests).values({ eventId: e.id, transmitterId: ctx.me }).onConflictDoNothing();
    else await db.delete(eventInterests).where(and(eq(eventInterests.eventId, e.id), eq(eventInterests.transmitterId, ctx.me)));
    await broadcast(ctx.beaconId, e);
    const [event] = await serialize([e], ctx.me);
    return reply.send({ event });
  };
  app.put('/:id/events/:eventId/interest', interest(true));
  app.delete('/:id/events/:eventId/interest', interest(false));

  app.get('/:id/events/:eventId/interested', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const e = await eventIn(ctx.beaconId, (request.params as any).eventId);
    if (!e) return reply.status(404).send({ error: 'Event not found' });
    const users = await db.select(userRef).from(eventInterests).innerJoin(transmitters, eq(eventInterests.transmitterId, transmitters.id)).where(eq(eventInterests.eventId, e.id)).orderBy(asc(eventInterests.createdAt));
    return reply.send({ users });
  });
};
