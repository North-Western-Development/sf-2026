import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, lt, desc, inArray, auditLog, automodRules, relays, transmitters } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { AUTHOR_FIELDS } from '../../lib/transmissions.js';
import { audit } from '../../lib/audit.js';
import { PRESET_LISTS } from '../../lib/automod.js';

const TRIGGERS = ['keyword', 'preset', 'mention_spam', 'spam'];
const TIMEOUTS = [0, 60, 300, 600, 3600, 86400, 604800];
/** Discord's caps. */
const MAX_RULES = { keyword: 6, preset: 1, mention_spam: 1, spam: 1 } as Record<string, number>;

const RULE_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    trigger: { type: 'string', enum: TRIGGERS },
    keywords: { type: 'array', maxItems: 1000, items: { type: 'string', minLength: 1, maxLength: 60 } },
    regexes: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 260 } },
    allowList: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 60 } },
    presets: { type: 'array', items: { type: 'string', enum: Object.keys(PRESET_LISTS) } },
    mentionLimit: { type: 'integer', minimum: 1, maximum: 50 },
    blockMessage: { type: 'boolean' },
    customMessage: { type: ['string', 'null'], maxLength: 150 },
    alertChannelId: { type: ['string', 'null'], format: 'uuid' },
    timeoutSeconds: { type: 'integer', enum: TIMEOUTS },
    exemptClearanceIds: { type: 'array', maxItems: 20, items: { type: 'string', format: 'uuid' } },
    exemptRelayIds: { type: 'array', maxItems: 50, items: { type: 'string', format: 'uuid' } },
    enabled: { type: 'boolean' },
  },
};

/**
 * Moderation (beacon settings): the Audit Log and AutoMod rules.
 *   GET    /api/v1/beacons/:id/audit-log?action=&actorId=&before=&limit=
 *   GET    /api/v1/beacons/:id/automod/rules
 *   POST   /api/v1/beacons/:id/automod/rules
 *   PATCH  /api/v1/beacons/:id/automod/rules/:ruleId
 *   DELETE /api/v1/beacons/:id/automod/rules/:ruleId
 */
export const moderationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function actorWith(request: any, reply: any, perm: bigint) {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    const { id: beaconId } = request.params as { id: string };
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' }), null;
    if (!hasPermission(actor.effectivePermissions, perm)) return reply.status(403).send({ error: 'Missing permission' }), null;
    return { beaconId, actorId: token.transmitterId };
  }

  app.get('/:id/audit-log', async (request, reply) => {
    const ctx = await actorWith(request, reply, PERMISSIONS.VIEW_AUDIT_LOG);
    if (!ctx) return;
    const q = request.query as { action?: string; actorId?: string; before?: string; limit?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const where = [eq(auditLog.beaconId, ctx.beaconId)];
    if (q.action) where.push(eq(auditLog.action, q.action));
    if (q.actorId) where.push(eq(auditLog.actorId, q.actorId));
    if (q.before && !Number.isNaN(Date.parse(q.before))) where.push(lt(auditLog.createdAt, new Date(q.before)));
    const rows = await db.select().from(auditLog).where(and(...where)).orderBy(desc(auditLog.createdAt)).limit(limit);
    const ids = [...new Set(rows.map((r: any) => r.actorId).filter(Boolean))] as string[];
    const actors = ids.length ? await db.select(AUTHOR_FIELDS).from(transmitters).where(inArray(transmitters.id, ids)) : [];
    const byId = new Map(actors.map((a: any) => [a.id, a]));
    return reply.send({ entries: rows.map((r: any) => ({ ...r, actor: r.actorId ? byId.get(r.actorId) ?? null : null })) });
  });

  app.get('/:id/automod/rules', async (request, reply) => {
    const ctx = await actorWith(request, reply, PERMISSIONS.MANAGE_BEACON);
    if (!ctx) return;
    const rules = await db.select().from(automodRules).where(eq(automodRules.beaconId, ctx.beaconId)).orderBy(automodRules.createdAt);
    return reply.send({ rules, presets: Object.keys(PRESET_LISTS) });
  });

  /** Relays named in a rule must be in the beacon; regexes must compile. */
  async function validate(beaconId: string, body: any): Promise<string | null> {
    for (const source of body.regexes ?? []) {
      try {
        new RegExp(source, 'iu');
      } catch {
        return `Invalid pattern: ${source}`;
      }
    }
    const relayIds = [...(body.exemptRelayIds ?? []), ...(body.alertChannelId ? [body.alertChannelId] : [])];
    if (relayIds.length) {
      const found = await db.select({ id: relays.id }).from(relays).where(and(eq(relays.beaconId, beaconId), inArray(relays.id, relayIds)));
      if (found.length !== new Set(relayIds).size) return 'Relays must be in this beacon';
    }
    return null;
  }

  app.post('/:id/automod/rules', { schema: { body: { ...RULE_BODY, required: ['name', 'trigger'] } } }, async (request, reply) => {
    const ctx = await actorWith(request, reply, PERMISSIONS.MANAGE_BEACON);
    if (!ctx) return;
    const body = request.body as any;
    const existing = await db.select({ id: automodRules.id }).from(automodRules).where(and(eq(automodRules.beaconId, ctx.beaconId), eq(automodRules.trigger, body.trigger)));
    if (existing.length >= MAX_RULES[body.trigger]) return reply.status(400).send({ error: `A beacon can have ${MAX_RULES[body.trigger]} ${body.trigger.replace('_', ' ')} rule(s)`, code: 'RULE_LIMIT' });
    const problem = await validate(ctx.beaconId, body);
    if (problem) return reply.status(400).send({ error: problem });
    const [rule] = await db.insert(automodRules).values({ ...body, beaconId: ctx.beaconId, creatorId: ctx.actorId }).returning();
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'automod_rule_create', targetType: 'automod_rule', targetId: rule.id, targetName: rule.name });
    return reply.status(201).send({ rule });
  });

  app.patch('/:id/automod/rules/:ruleId', { schema: { body: RULE_BODY } }, async (request, reply) => {
    const ctx = await actorWith(request, reply, PERMISSIONS.MANAGE_BEACON);
    if (!ctx) return;
    const { ruleId } = request.params as { ruleId: string };
    const body = request.body as any;
    delete body.trigger; // a rule keeps its trigger
    const problem = await validate(ctx.beaconId, body);
    if (problem) return reply.status(400).send({ error: problem });
    const [rule] = await db.update(automodRules).set(body).where(and(eq(automodRules.id, ruleId), eq(automodRules.beaconId, ctx.beaconId))).returning();
    if (!rule) return reply.status(404).send({ error: 'Rule not found' });
    await audit(db, {
      beaconId: ctx.beaconId,
      actorId: ctx.actorId,
      action: 'automod_rule_update',
      targetType: 'automod_rule',
      targetId: rule.id,
      targetName: rule.name,
      changes: Object.entries(body).map(([key, value]) => ({ key, new: value })),
    });
    return reply.send({ rule });
  });

  app.delete('/:id/automod/rules/:ruleId', async (request, reply) => {
    const ctx = await actorWith(request, reply, PERMISSIONS.MANAGE_BEACON);
    if (!ctx) return;
    const { ruleId } = request.params as { ruleId: string };
    const [rule] = await db.delete(automodRules).where(and(eq(automodRules.id, ruleId), eq(automodRules.beaconId, ctx.beaconId))).returning();
    if (!rule) return reply.status(404).send({ error: 'Rule not found' });
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'automod_rule_delete', targetType: 'automod_rule', targetId: rule.id, targetName: rule.name });
    return reply.send({ message: 'Rule deleted' });
  });
};
