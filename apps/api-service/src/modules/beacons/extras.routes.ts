import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  sql,
  beacons,
  beaconMembers,
  beaconTemplates,
  invites,
  relays,
  transmissions,
  transmitters,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { AUTHOR_FIELDS } from '../../lib/transmissions.js';
import { audit } from '../../lib/audit.js';
import { snapshotOf } from '../../lib/templates.js';

const DAY = 86_400_000;

/**
 * Beacon extras from Discord's server settings:
 *   Templates  GET|POST|PATCH|DELETE /beacons/:id/template, PUT /beacons/:id/template/sync,
 *              GET /templates/:code
 *   Insights   GET /beacons/:id/insights?days=
 *   Widget     GET /beacons/:id/widget.json   (public when the beacon turns it on)
 *   Tags       GET /beacon-tags?ids=, PUT /users/@me/tag { beaconId }
 */
export const beaconExtrasRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = (app as any).redis;

  async function manager(request: any, reply: any) {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    const { id: beaconId } = request.params as { id: string };
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' }), null;
    if (!hasPermission(actor.effectivePermissions, PERMISSIONS.MANAGE_BEACON)) return reply.status(403).send({ error: 'Transmitter lacks MANAGE_BEACON clearance' }), null;
    return { beaconId, actorId: token.transmitterId };
  }

  // ------------------------------------------------------------------ Templates

  app.get('/beacons/:id/template', async (request, reply) => {
    const ctx = await manager(request, reply);
    if (!ctx) return;
    const [template] = await db.select().from(beaconTemplates).where(eq(beaconTemplates.beaconId, ctx.beaconId)).limit(1);
    return reply.send({ template: template ?? null });
  });

  const TEMPLATE_BODY = {
    type: 'object',
    additionalProperties: false,
    properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: ['string', 'null'], maxLength: 120 } },
  };

  app.post('/beacons/:id/template', { schema: { body: { ...TEMPLATE_BODY, required: ['name'] } } }, async (request, reply) => {
    const ctx = await manager(request, reply);
    if (!ctx) return;
    const [existing] = await db.select().from(beaconTemplates).where(eq(beaconTemplates.beaconId, ctx.beaconId)).limit(1);
    if (existing) return reply.status(409).send({ error: 'This beacon already has a template', code: 'TEMPLATE_EXISTS' });
    const body = request.body as { name: string; description?: string | null };
    const [template] = await db
      .insert(beaconTemplates)
      .values({ code: randomBytes(9).toString('base64url'), beaconId: ctx.beaconId, name: body.name.trim(), description: body.description?.trim() || null, snapshot: await snapshotOf(db, ctx.beaconId), creatorId: ctx.actorId })
      .returning();
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'template_create', targetType: 'template', targetId: template.code, targetName: template.name });
    return reply.status(201).send({ template });
  });

  app.patch('/beacons/:id/template', { schema: { body: TEMPLATE_BODY } }, async (request, reply) => {
    const ctx = await manager(request, reply);
    if (!ctx) return;
    const body = request.body as { name?: string; description?: string | null };
    const [template] = await db
      .update(beaconTemplates)
      .set({ ...(body.name ? { name: body.name.trim() } : {}), ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}), updatedAt: new Date() })
      .where(eq(beaconTemplates.beaconId, ctx.beaconId))
      .returning();
    if (!template) return reply.status(404).send({ error: 'No template' });
    return reply.send({ template });
  });

  app.put('/beacons/:id/template/sync', async (request, reply) => {
    const ctx = await manager(request, reply);
    if (!ctx) return;
    const [template] = await db
      .update(beaconTemplates)
      .set({ snapshot: await snapshotOf(db, ctx.beaconId), updatedAt: new Date() })
      .where(eq(beaconTemplates.beaconId, ctx.beaconId))
      .returning();
    if (!template) return reply.status(404).send({ error: 'No template' });
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'template_sync', targetType: 'template', targetId: template.code, targetName: template.name });
    return reply.send({ template });
  });

  app.delete('/beacons/:id/template', async (request, reply) => {
    const ctx = await manager(request, reply);
    if (!ctx) return;
    const [template] = await db.delete(beaconTemplates).where(eq(beaconTemplates.beaconId, ctx.beaconId)).returning();
    if (!template) return reply.status(404).send({ error: 'No template' });
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'template_delete', targetType: 'template', targetId: template.code, targetName: template.name });
    return reply.send({ message: 'Template deleted' });
  });

  /** A template's preview for its link page: what it builds, never who is in the source beacon. */
  app.get('/templates/:code', async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { code } = request.params as { code: string };
    const [template] = await db.select().from(beaconTemplates).where(eq(beaconTemplates.code, code)).limit(1);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    const [source] = await db.select({ name: beacons.name, iconUrl: beacons.iconUrl }).from(beacons).where(eq(beacons.id, template.beaconId)).limit(1);
    const [creator] = template.creatorId ? await db.select(AUTHOR_FIELDS).from(transmitters).where(eq(transmitters.id, template.creatorId)).limit(1) : [];
    const { beaconId: _hidden, ...rest } = template;
    return reply.send({ template: { ...rest, source: source ?? null, creator: creator ?? null } });
  });

  // ------------------------------------------------------------------ Insights

  app.get('/beacons/:id/insights', async (request, reply) => {
    const ctx = await manager(request, reply);
    if (!ctx) return;
    const days = Math.min(90, Math.max(7, Number((request.query as any).days) || 30));
    const since = new Date(Date.now() - days * DAY);
    const relayRows = await db.select({ id: relays.id, name: relays.name, type: relays.type }).from(relays).where(eq(relays.beaconId, ctx.beaconId));
    const relayIds = relayRows.map((r: any) => r.id);
    const day = sql<string>`to_char(date_trunc('day', ${transmissions.createdAt}), 'YYYY-MM-DD')`;

    const members = await db.select({ joinedAt: beaconMembers.joinedAt, joinMethod: beaconMembers.joinMethod }).from(beaconMembers).where(eq(beaconMembers.beaconId, ctx.beaconId));
    const joins = new Map<string, number>();
    const methods: Record<string, number> = {};
    for (const m of members) {
      methods[m.joinMethod ?? 'unknown'] = (methods[m.joinMethod ?? 'unknown'] ?? 0) + 1;
      if (new Date(m.joinedAt) >= since) {
        const k = new Date(m.joinedAt).toISOString().slice(0, 10);
        joins.set(k, (joins.get(k) ?? 0) + 1);
      }
    }

    const written = and(inArray(transmissions.type, ['default', 'reply']), gte(transmissions.createdAt, since));
    const perDay = relayIds.length
      ? await db
          .select({ day, messages: sql<number>`count(*)::int`, communicators: sql<number>`count(distinct ${transmissions.transmitterId})::int` })
          .from(transmissions)
          .where(and(inArray(transmissions.relayId, relayIds), written))
          .groupBy(day)
      : [];
    const perRelay = relayIds.length
      ? await db
          .select({ relayId: transmissions.relayId, messages: sql<number>`count(*)::int` })
          .from(transmissions)
          .where(and(inArray(transmissions.relayId, relayIds), written))
          .groupBy(transmissions.relayId)
      : [];
    const [{ communicators }] = relayIds.length
      ? await db.select({ communicators: sql<number>`count(distinct ${transmissions.transmitterId})::int` }).from(transmissions).where(and(inArray(transmissions.relayId, relayIds), written))
      : [{ communicators: 0 }];

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
      const row = perDay.find((r: any) => r.day === k);
      series.push({ day: k, joins: joins.get(k) ?? 0, messages: row?.messages ?? 0, communicators: row?.communicators ?? 0 });
    }
    const names = new Map(relayRows.map((r: any) => [r.id, r.name]));
    return reply.send({
      days,
      totals: { members: members.length, newMembers: [...joins.values()].reduce((a, b) => a + b, 0), messages: series.reduce((a, s) => a + s.messages, 0), communicators },
      joinMethods: methods,
      series,
      topRelays: perRelay
        .sort((a: any, b: any) => b.messages - a.messages)
        .slice(0, 5)
        .map((r: any) => ({ relayId: r.relayId, name: names.get(r.relayId) ?? '', messages: r.messages })),
    });
  });

  // ------------------------------------------------------------------ Widget

  app.get('/beacons/:id/widget.json', { config: { public: true } }, async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { id } = request.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(404).send({ error: 'Widget disabled' });
    const [beacon] = await db.select().from(beacons).where(eq(beacons.id, id)).limit(1);
    if (!beacon?.widgetEnabled) return reply.status(403).send({ error: 'Widget disabled', code: 'WIDGET_DISABLED' });

    // The widget's invite: one that never expires, made by the owner for the chosen relay.
    let instantInvite: string | null = null;
    if (beacon.widgetChannelId) {
      const [existing] = await db
        .select({ code: invites.code })
        .from(invites)
        .where(and(eq(invites.beaconId, id), eq(invites.relayId, beacon.widgetChannelId), eq(invites.inviterId, beacon.ownerId), isNull(invites.expiresAt), eq(invites.maxUses, 0)))
        .limit(1);
      instantInvite = existing?.code ?? null;
      if (!instantInvite) {
        instantInvite = randomBytes(6).toString('base64url');
        await db.insert(invites).values({ code: instantInvite, beaconId: id, relayId: beacon.widgetChannelId, inviterId: beacon.ownerId, maxUses: 0, maxAgeSeconds: 0, expiresAt: null });
      }
    }

    const rows = await db
      .select({ id: transmitters.id, username: transmitters.username, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl })
      .from(beaconMembers)
      .innerJoin(transmitters, eq(transmitters.id, beaconMembers.transmitterId))
      .where(eq(beaconMembers.beaconId, id));
    let presence: Array<string | null> = [];
    if (redis && rows.length) presence = await redis.hmget('presence', ...rows.map((r: any) => r.id)).catch(() => []);
    const online = rows
      .map((r: any, i: number) => ({ ...r, status: presence[i] ?? 'offline' }))
      .filter((r: any) => r.status !== 'offline' && r.status !== 'invisible');

    reply.header('access-control-allow-origin', '*');
    reply.header('cache-control', 'public, max-age=60');
    return reply.send({
      id: beacon.id,
      name: beacon.name,
      iconUrl: beacon.iconUrl,
      instantInvite,
      presenceCount: online.length,
      memberCount: rows.length,
      // Like Discord's: online members only, first 100, no ids.
      members: online.slice(0, 100).map((m: any) => ({ username: m.displayName || m.username, avatarUrl: m.avatarUrl, status: m.status })),
    });
  });

  // ------------------------------------------------------------------ Beacon tags

  app.get('/beacon-tags', async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const ids = String((request.query as any).ids ?? '')
      .split(',')
      .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
      .slice(0, 100);
    if (!ids.length) return reply.send({ tags: [] });
    const rows = await db.select({ id: beacons.id, name: beacons.name, tag: beacons.tag, tagBadge: beacons.tagBadge }).from(beacons).where(inArray(beacons.id, ids));
    return reply.send({ tags: rows.filter((r: any) => r.tag) });
  });

  /** Wear a beacon's tag beside your name (you must be a member and it must have one), or none. */
  app.put('/users/@me/tag', { schema: { body: { type: 'object', additionalProperties: false, required: ['beaconId'], properties: { beaconId: { type: ['string', 'null'], format: 'uuid' } } } } }, async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { beaconId } = request.body as { beaconId: string | null };
    if (beaconId) {
      const [row] = await db
        .select({ tag: beacons.tag })
        .from(beaconMembers)
        .innerJoin(beacons, eq(beacons.id, beaconMembers.beaconId))
        .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, token.transmitterId)))
        .limit(1);
      if (!row) return reply.status(403).send({ error: 'You can only wear the tag of a beacon you are in' });
      if (!row.tag) return reply.status(400).send({ error: 'That beacon has no tag' });
    }
    await db.update(transmitters).set({ tagBeaconId: beaconId }).where(eq(transmitters.id, token.transmitterId));
    return reply.send({ tagBeaconId: beaconId });
  });
};
