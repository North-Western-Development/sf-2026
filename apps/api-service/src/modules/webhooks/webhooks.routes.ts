import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, desc, relays, webhooks } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { loadChannel } from '../../lib/channels.js';
import { createAppUser, renameAppUser, newSecret, hashSecret } from '../../lib/app-users.js';
import { postAppMessage } from '../../lib/app-messages.js';
import { normalizeRichEmbeds, EmbedError, RICH_EMBEDS_SCHEMA, type RichEmbedInput } from '../../lib/rich-embeds.js';
import { checkRateLimit } from '../../lib/rate-limit.js';
import { audit } from '../../lib/audit.js';

const MAX_TRANSMISSION_LENGTH = 2000;
const NAME = { type: 'string', minLength: 1, maxLength: 80 } as const;
const URL_FIELD = { type: ['string', 'null'], maxLength: 2048 } as const;
const httpsUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

/**
 * Webhooks (Discord's): a secret URL that posts into one relay.
 *   GET    /relays/:relayId/webhooks           Manage Webhooks
 *   GET    /beacons/:beaconId/webhooks         every relay's, where the caller may manage them
 *   POST   /relays/:relayId/webhooks           { name, avatarUrl? }   the URL is in the answer, once
 *   PATCH  /webhooks/:id                       { name?, avatarUrl?, relayId? }
 *   POST   /webhooks/:id/reset-token           a new URL; the old one stops working
 *   DELETE /webhooks/:id
 *   POST   /webhooks/:id/:token                public: { content?, username?, avatarUrl?, embeds? }
 * Messages from a webhook never ping @everyone or @here.
 */
export const webhookRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = (app as any).redis;

  const view = (w: any, token?: string) => ({
    id: w.id,
    beaconId: w.beaconId,
    relayId: w.relayId,
    name: w.name,
    avatarUrl: w.avatarUrl,
    creatorId: w.creatorId,
    /** Set on a follower webhook: the announcement relay this relay follows. */
    sourceRelayId: w.sourceRelayId ?? null,
    createdAt: w.createdAt,
    ...(token ? { token, url: `/api/v1/webhooks/${w.id}/${token}` } : {}),
  });

  /** The relay, if the caller holds Manage Webhooks there. */
  async function managedRelay(request: any, reply: any, relayId: string) {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
    if (!relay || !['text', 'archival', 'visual'].includes(relay.type)) return reply.status(404).send({ error: 'Relay not found' }), null;
    const actor = await resolveRelayActorContext(db, token.transmitterId, relay);
    if (!actor || !hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY)) return reply.status(404).send({ error: 'Relay not found' }), null;
    if (!hasPermission(actor.effectivePermissions, PERMISSIONS.MANAGE_WEBHOOKS)) return reply.status(403).send({ error: 'Transmitter lacks MANAGE_WEBHOOKS clearance', code: 'MISSING_PERMISSIONS' }), null;
    return { me: token.transmitterId as string, relay };
  }
  async function managedWebhook(request: any, reply: any) {
    const { id } = request.params as { id: string };
    const [w] = db ? await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1) : [];
    if (!w) return reply.status(404).send({ error: 'Webhook not found' }), null;
    const ctx = await managedRelay(request, reply, w.relayId);
    return ctx ? { ...ctx, webhook: w } : null;
  }

  app.get('/relays/:relayId/webhooks', async (request, reply) => {
    const ctx = await managedRelay(request, reply, (request.params as any).relayId);
    if (!ctx) return;
    const rows = await db.select().from(webhooks).where(eq(webhooks.relayId, ctx.relay.id)).orderBy(desc(webhooks.createdAt));
    return reply.send({ webhooks: rows.map((w: any) => view(w)) });
  });

  app.get('/beacons/:beaconId/webhooks', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { beaconId } = request.params as { beaconId: string };
    const rows = await db.select().from(webhooks).where(eq(webhooks.beaconId, beaconId)).orderBy(desc(webhooks.createdAt));
    const relayIds: string[] = [...new Set<string>(rows.map((w: any) => w.relayId))];
    const allowed = new Set<string>();
    for (const relayId of relayIds) {
      const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
      const actor = relay ? await resolveRelayActorContext(db, token.transmitterId, relay) : null;
      if (actor && hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY) && hasPermission(actor.effectivePermissions, PERMISSIONS.MANAGE_WEBHOOKS)) allowed.add(relayId);
    }
    return reply.send({ webhooks: rows.filter((w: any) => allowed.has(w.relayId)).map((w: any) => view(w)) });
  });

  app.post(
    '/relays/:relayId/webhooks',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: NAME, avatarUrl: URL_FIELD } } } },
    async (request, reply) => {
      const ctx = await managedRelay(request, reply, (request.params as any).relayId);
      if (!ctx) return;
      const existing = await db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.beaconId, ctx.relay.beaconId));
      if (existing.length >= 50) return reply.status(400).send({ error: 'A beacon can have 50 webhooks', code: 'WEBHOOK_LIMIT' });
      const body = request.body as { name: string; avatarUrl?: string | null };
      const avatarUrl = httpsUrl(body.avatarUrl);
      const authorId = await createAppUser(db, 'webhook', body.name.trim(), avatarUrl);
      const secret = newSecret();
      const [w] = await db
        .insert(webhooks)
        .values({ beaconId: ctx.relay.beaconId, relayId: ctx.relay.id, authorId, name: body.name.trim(), avatarUrl, tokenHash: hashSecret(secret), creatorId: ctx.me })
        .returning();
      await audit(db, { beaconId: ctx.relay.beaconId, actorId: ctx.me, action: 'webhook_create', targetType: 'webhook', targetId: w.id, targetName: w.name });
      return reply.status(201).send({ webhook: view(w, secret) });
    }
  );

  app.patch(
    '/webhooks/:id',
    { schema: { body: { type: 'object', additionalProperties: false, properties: { name: NAME, avatarUrl: URL_FIELD, relayId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } } } },
    async (request, reply) => {
      const ctx = await managedWebhook(request, reply);
      if (!ctx) return;
      const body = request.body as { name?: string; avatarUrl?: string | null; relayId?: string };
      const set: Record<string, unknown> = {};
      if (body.name !== undefined) set.name = body.name.trim();
      if (body.avatarUrl !== undefined) set.avatarUrl = httpsUrl(body.avatarUrl);
      if (body.relayId && body.relayId !== ctx.webhook.relayId) {
        // Moving it needs Manage Webhooks in the new relay too, in the same beacon.
        const target = await managedRelay(request, reply, body.relayId);
        if (!target) return;
        if (target.relay.beaconId !== ctx.webhook.beaconId) return reply.status(400).send({ error: 'Webhooks stay in their beacon', code: 'OTHER_BEACON' });
        set.relayId = body.relayId;
      }
      const [w] = await db.update(webhooks).set(set).where(eq(webhooks.id, ctx.webhook.id)).returning();
      await renameAppUser(db, w.authorId, w.name, w.avatarUrl);
      return reply.send({ webhook: view(w) });
    }
  );

  app.post('/webhooks/:id/reset-token', async (request, reply) => {
    const ctx = await managedWebhook(request, reply);
    if (!ctx) return;
    // A follower webhook posts only what its announcement relay publishes: it has no URL to give out.
    if (ctx.webhook.sourceRelayId) return reply.status(400).send({ error: 'A followed relay has no webhook URL', code: 'FOLLOWER_WEBHOOK' });
    const secret = newSecret();
    const [w] = await db.update(webhooks).set({ tokenHash: hashSecret(secret) }).where(eq(webhooks.id, ctx.webhook.id)).returning();
    return reply.send({ webhook: view(w, secret) });
  });

  app.delete('/webhooks/:id', async (request, reply) => {
    const ctx = await managedWebhook(request, reply);
    if (!ctx) return;
    await db.delete(webhooks).where(eq(webhooks.id, ctx.webhook.id));
    // Its messages stay, under the name it had (Discord keeps them too).
    await audit(db, { beaconId: ctx.webhook.beaconId, actorId: ctx.me, action: 'webhook_delete', targetType: 'webhook', targetId: ctx.webhook.id, targetName: ctx.webhook.name });
    return reply.send({ deleted: true });
  });

  app.post(
    '/webhooks/:id/:token',
    {
      config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, token: { type: 'string', maxLength: 100 } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', maxLength: MAX_TRANSMISSION_LENGTH },
            username: { type: 'string', minLength: 1, maxLength: 80 },
            avatarUrl: { type: 'string', maxLength: 2048 },
            embeds: RICH_EMBEDS_SCHEMA,
          },
        },
      },
    },
    async (request, reply) => {
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { id, token } = request.params as { id: string; token: string };
      const [w] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.tokenHash, hashSecret(token)))).limit(1);
      // Same answer for a wrong id and a wrong token.
      if (!w) return reply.status(404).send({ error: 'Unknown webhook', code: 'UNKNOWN_WEBHOOK' });
      // 5 a second per webhook on top of the per-address limit, as Discord does.
      if (!(await checkRateLimit(redis, `rl:webhook:${w.id}`, 5, 2))) return reply.status(429).send({ error: 'Slow down', code: 'RATE_LIMITED' });
      const body = request.body as { content?: string; username?: string; avatarUrl?: string; embeds?: RichEmbedInput[] };
      let embeds;
      try {
        embeds = normalizeRichEmbeds(body.embeds);
      } catch (err) {
        if (err instanceof EmbedError) return reply.status(400).send({ error: err.message, code: 'EMBED_TOO_LARGE' });
        throw err;
      }
      const content = (body.content ?? '').trim();
      if (!content && !embeds.length) return reply.status(400).send({ error: 'Send content or embeds', code: 'EMPTY_MESSAGE' });
      const channel = await loadChannel(db, 'relay', w.relayId);
      if (!channel) return reply.status(404).send({ error: 'Unknown webhook', code: 'UNKNOWN_WEBHOOK' });
      const override = body.username || body.avatarUrl ? { name: body.username?.trim() || w.name, avatarUrl: httpsUrl(body.avatarUrl) ?? w.avatarUrl } : null;
      const transmission = await postAppMessage(app, { channel, authorId: w.authorId, content, embeds, override, webhookId: w.id });
      return reply.status(200).send({ transmission });
    }
  );

};
