import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, or, lt, lte, desc, asc, ne, inArray, isNull, sql, beaconMembers, beacons, relays, transmissions, pointToPointLinks, subspaceMeshMembers, bookmarks, reminders } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { deriveChannel, formatTransmission } from '../../lib/transmissions.js';
import { checkChannelAccess, loadChannel } from '../../lib/channels.js';
import { publishGatewayEvent } from '../../lib/events.js';

const ID = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const MAX_BOOKMARKS = 500;
const MAX_REMINDERS = 100;
const YEAR_MS = 366 * 86_400_000;

/**
 * A transmission as the Inbox shows it, with where it is, if they can still read it there;
 * otherwise null (they left the beacon, lost the clearance, or it was deleted).
 */
async function inboxItem(db: any, transmissionId: string, me: string) {
  const [row] = await db.select().from(transmissions).where(eq(transmissions.id, transmissionId)).limit(1);
  const where = row ? deriveChannel(row) : null;
  if (!row || !where) return null;
  const channel = await loadChannel(db, where.channelType, where.channelId);
  if (!channel || !(await checkChannelAccess(db, channel, me, 'view')).allowed) return null;
  let info: Record<string, unknown> = { channelType: where.channelType, channelId: where.channelId };
  if (row.relayId) {
    const [relay] = await db.select({ name: relays.name, beaconId: relays.beaconId }).from(relays).where(eq(relays.id, row.relayId)).limit(1);
    const [b] = relay ? await db.select({ name: beacons.name }).from(beacons).where(eq(beacons.id, relay.beaconId)).limit(1) : [];
    info = { ...info, name: relay?.name ?? '', beaconId: relay?.beaconId ?? null, beaconName: b?.name ?? '' };
  }
  return { transmission: await formatTransmission(db, row, me, { beaconId: (info.beaconId as string) ?? undefined }), channel: info };
}

/**
 * Reminders that came due: tell their owner's devices once (REMINDER_DUE). Runs every 30 seconds
 * (and from tests directly).
 */
export async function deliverDueReminders(app: FastifyInstance) {
  const db = (app as any).db;
  if (!db) return 0;
  const due = await db
    .select()
    .from(reminders)
    .where(and(lte(reminders.remindAt, new Date()), isNull(reminders.notifiedAt), isNull(reminders.doneAt)))
    .orderBy(asc(reminders.remindAt))
    .limit(200);
  for (const r of due) {
    await db.update(reminders).set({ notifiedAt: new Date() }).where(eq(reminders.id, r.id));
    const item = await inboxItem(db, r.transmissionId, r.transmitterId);
    await publishGatewayEvent(app, 'REMINDER_DUE', { reminder: { id: r.id, remindAt: r.remindAt, ...(item ?? { transmission: null, channel: null }) } }, { transmitterIds: [r.transmitterId] });
  }
  return due.length;
}

/**
 * The Inbox's Mentions tab (Discord's): recent transmissions that mention you, by name, by a
 * clearance you hold, or with @everyone/@here, in places you can still read.
 *   GET /api/v1/users/@me/mentions?before=<iso>&limit=&everyone=&roles=
 */
export const inboxRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  app.get('/users/@me/mentions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const me = token.transmitterId;
    const q = request.query as { before?: string; limit?: string; everyone?: string; roles?: string };
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 25));
    const before = q.before && !Number.isNaN(Date.parse(q.before)) ? new Date(q.before) : new Date();
    const withEveryone = q.everyone !== 'false';
    const withRoles = q.roles !== 'false';

    const memberships = await db.select({ beaconId: beaconMembers.beaconId, clearanceIds: beaconMembers.clearanceIds }).from(beaconMembers).where(eq(beaconMembers.transmitterId, me));
    const beaconIds = memberships.map((m: any) => m.beaconId);
    const roleIds = withRoles ? memberships.flatMap((m: any) => m.clearanceIds as string[]) : [];
    const myRelays = beaconIds.length ? await db.select({ id: relays.id }).from(relays).where(inArray(relays.beaconId, beaconIds)) : [];
    const links = await db.select({ id: pointToPointLinks.id }).from(pointToPointLinks).where(or(eq(pointToPointLinks.transmitter1Id, me), eq(pointToPointLinks.transmitter2Id, me)));
    const meshes = await db.select({ id: subspaceMeshMembers.meshId }).from(subspaceMeshMembers).where(eq(subspaceMeshMembers.transmitterId, me));

    const places = [
      myRelays.length ? inArray(transmissions.relayId, myRelays.map((r: any) => r.id)) : null,
      links.length ? inArray(transmissions.p2pLinkId, links.map((l: any) => l.id)) : null,
      meshes.length ? inArray(transmissions.meshId, meshes.map((m: any) => m.id)) : null,
    ].filter(Boolean) as any[];
    if (!places.length) return reply.send({ mentions: [] });

    const mentioned = [
      sql`${transmissions.mentions} @> ${JSON.stringify([me])}::jsonb`,
      withEveryone ? eq(transmissions.mentionEveryone, true) : null,
      roleIds.length ? sql`jsonb_exists_any(${transmissions.mentionRoles}, ARRAY[${sql.join(roleIds.map((r: string) => sql`${r}`), sql`, `)}]::text[])` : null,
    ].filter(Boolean) as any[];

    const rows = await db
      .select()
      .from(transmissions)
      .where(and(lt(transmissions.createdAt, before), ne(transmissions.transmitterId, me), or(...places), or(...mentioned)))
      .orderBy(desc(transmissions.createdAt))
      .limit(limit * 2);

    // Keep only relays you can still see.
    const canSee = new Map<string, boolean>();
    const relayInfo = new Map<string, { name: string; beaconId: string; beaconName: string }>();
    const out: any[] = [];
    for (const row of rows) {
      if (out.length >= limit) break;
      if (row.relayId) {
        if (!canSee.has(row.relayId)) {
          const [relay] = await db.select().from(relays).where(eq(relays.id, row.relayId)).limit(1);
          const actor = relay ? await resolveRelayActorContext(db, me, relay) : null;
          canSee.set(row.relayId, !!actor && hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY));
          if (relay) {
            const [b] = await db.select({ name: beacons.name }).from(beacons).where(eq(beacons.id, relay.beaconId)).limit(1);
            relayInfo.set(relay.id, { name: relay.name, beaconId: relay.beaconId, beaconName: b?.name ?? '' });
          }
        }
        if (!canSee.get(row.relayId)) continue;
      }
      const info = row.relayId ? relayInfo.get(row.relayId) : null;
      out.push({
        transmission: await formatTransmission(db, row, me, { beaconId: info?.beaconId }),
        channel: row.relayId
          ? { channelType: 'relay', channelId: row.relayId, name: info?.name ?? '', beaconId: info?.beaconId ?? null, beaconName: info?.beaconName ?? '' }
          : row.p2pLinkId
            ? { channelType: 'link', channelId: row.p2pLinkId }
            : row.meshId
              ? { channelType: 'mesh', channelId: row.meshId }
              : { channelType: 'thread', channelId: row.threadId },
      });
    }
    return reply.send({ mentions: out });
  });

  // ---- Bookmarks -----------------------------------------------------------------------------------

  /** GET /api/v1/users/@me/bookmarks: newest first, only what they can still read. */
  app.get('/users/@me/bookmarks', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const rows = await db.select().from(bookmarks).where(eq(bookmarks.transmitterId, token.transmitterId)).orderBy(desc(bookmarks.createdAt)).limit(MAX_BOOKMARKS);
    const out = [];
    for (const b of rows) {
      const item = await inboxItem(db, b.transmissionId, token.transmitterId);
      if (item) out.push({ ...item, bookmarkedAt: b.createdAt });
    }
    return reply.send({ bookmarks: out });
  });

  app.put('/users/@me/bookmarks/:transmissionId', { schema: { params: { type: 'object', properties: { transmissionId: ID } } } }, async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { transmissionId } = request.params as { transmissionId: string };
    // Only what they can read: otherwise the same answer as for one that does not exist.
    const item = await inboxItem(db, transmissionId, token.transmitterId);
    if (!item) return reply.status(404).send({ error: 'Transmission not found' });
    const count = await db.select({ n: sql<number>`count(*)::int` }).from(bookmarks).where(eq(bookmarks.transmitterId, token.transmitterId));
    if ((count[0]?.n ?? 0) >= MAX_BOOKMARKS) return reply.status(400).send({ error: `You can keep up to ${MAX_BOOKMARKS} bookmarks`, code: 'MAX_BOOKMARKS' });
    await db.insert(bookmarks).values({ transmitterId: token.transmitterId, transmissionId }).onConflictDoNothing();
    await publishGatewayEvent(app, 'BOOKMARK_UPDATE', { transmissionId, bookmarked: true }, { transmitterIds: [token.transmitterId] });
    return reply.status(204).send();
  });

  app.delete('/users/@me/bookmarks/:transmissionId', { schema: { params: { type: 'object', properties: { transmissionId: ID } } } }, async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { transmissionId } = request.params as { transmissionId: string };
    await db.delete(bookmarks).where(and(eq(bookmarks.transmitterId, token.transmitterId), eq(bookmarks.transmissionId, transmissionId)));
    await publishGatewayEvent(app, 'BOOKMARK_UPDATE', { transmissionId, bookmarked: false }, { transmitterIds: [token.transmitterId] });
    return reply.status(204).send();
  });

  // ---- Reminders -----------------------------------------------------------------------------------

  const reminderView = async (r: any, me: string) => {
    const item = await inboxItem(db, r.transmissionId, me);
    return item ? { id: r.id, remindAt: r.remindAt, due: new Date(r.remindAt) <= new Date(), ...item } : null;
  };
  const validTime = (raw: string) => {
    const at = Date.parse(raw);
    return Number.isNaN(at) || at < Date.now() - 60_000 || at > Date.now() + YEAR_MS ? null : new Date(at);
  };

  /** GET /api/v1/users/@me/reminders: those not done yet, soonest first. */
  app.get('/users/@me/reminders', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const rows = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.transmitterId, token.transmitterId), isNull(reminders.doneAt)))
      .orderBy(asc(reminders.remindAt))
      .limit(MAX_REMINDERS);
    const out = (await Promise.all(rows.map((r: any) => reminderView(r, token.transmitterId)))).filter(Boolean);
    return reply.send({ reminders: out });
  });

  app.post(
    '/users/@me/reminders',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['transmissionId', 'remindAt'], properties: { transmissionId: ID, remindAt: { type: 'string', maxLength: 40 } } } } },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      const { transmissionId, remindAt } = request.body as { transmissionId: string; remindAt: string };
      const at = validTime(remindAt);
      if (!at) return reply.status(400).send({ error: 'Pick a time within the next year', code: 'INVALID_REMIND_AT' });
      if (!(await inboxItem(db, transmissionId, token.transmitterId))) return reply.status(404).send({ error: 'Transmission not found' });
      const open = await db.select({ n: sql<number>`count(*)::int` }).from(reminders).where(and(eq(reminders.transmitterId, token.transmitterId), isNull(reminders.doneAt)));
      if ((open[0]?.n ?? 0) >= MAX_REMINDERS) return reply.status(400).send({ error: `You can have up to ${MAX_REMINDERS} reminders`, code: 'MAX_REMINDERS' });
      const [row] = await db.insert(reminders).values({ transmitterId: token.transmitterId, transmissionId, remindAt: at }).returning();
      return reply.status(201).send({ reminder: await reminderView(row, token.transmitterId) });
    }
  );

  app.patch(
    '/users/@me/reminders/:id',
    { schema: { params: { type: 'object', properties: { id: ID } }, body: { type: 'object', additionalProperties: false, properties: { done: { type: 'boolean' }, remindAt: { type: 'string', maxLength: 40 } } } } },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      const { id } = request.params as { id: string };
      const body = request.body as { done?: boolean; remindAt?: string };
      const set: Record<string, unknown> = {};
      if (body.done !== undefined) set.doneAt = body.done ? new Date() : null;
      if (body.remindAt !== undefined) {
        const at = validTime(body.remindAt);
        if (!at) return reply.status(400).send({ error: 'Pick a time within the next year', code: 'INVALID_REMIND_AT' });
        Object.assign(set, { remindAt: at, notifiedAt: null });
      }
      if (!Object.keys(set).length) return reply.status(400).send({ error: 'Nothing to change' });
      const [row] = await db.update(reminders).set(set).where(and(eq(reminders.id, id), eq(reminders.transmitterId, token.transmitterId))).returning();
      if (!row) return reply.status(404).send({ error: 'Reminder not found' });
      return reply.send({ reminder: { id: row.id, remindAt: row.remindAt, doneAt: row.doneAt } });
    }
  );

  app.delete('/users/@me/reminders/:id', { schema: { params: { type: 'object', properties: { id: ID } } } }, async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { id } = request.params as { id: string };
    const [row] = await db.delete(reminders).where(and(eq(reminders.id, id), eq(reminders.transmitterId, token.transmitterId))).returning({ id: reminders.id });
    if (!row) return reply.status(404).send({ error: 'Reminder not found' });
    return reply.status(204).send();
  });

  // Due reminders reach their owner's devices within half a minute.
  if (process.env.NODE_ENV !== 'test') {
    const timer = setInterval(() => void deliverDueReminders(app).catch((err) => app.log.warn({ err }, 'reminders: delivery failed')), 30_000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }
};
