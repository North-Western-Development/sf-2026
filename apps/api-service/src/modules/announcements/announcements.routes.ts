import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, isNull, beacons, relays, transmissions, webhooks, computeRelayPermissions } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { audienceForChannel, loadChannel } from '../../lib/channels.js';
import { createAppUser, newSecret, hashSecret } from '../../lib/app-users.js';
import { postAppMessage } from '../../lib/app-messages.js';
import { formatTransmission } from '../../lib/transmissions.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { checkRateLimit } from '../../lib/rate-limit.js';
import { audit } from '../../lib/audit.js';

const ID = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
/** Discord's limit: an announcement relay publishes at most 10 times an hour. */
const PUBLISHES_PER_HOUR = 10;
const MAX_WEBHOOKS_PER_BEACON = 50;

/** How a published announcement is signed in the relays that follow it: "Beacon #relay". */
const sourceName = (beaconName: string, relayName: string) => `${beaconName} #${relayName}`.slice(0, 80);

/**
 * Announcement relays (Discord's announcement channels). A transmission posted in one can be
 * published: a copy goes to every relay that follows it, signed with the source beacon's name
 * and icon. Following makes a follower webhook in the following relay (webhooks.sourceRelayId),
 * removed like any webhook.
 *   POST /channels/relay/:relayId/transmissions/:transmissionId/publish
 *   POST /relays/:relayId/followers   { targetRelayId }   follow it from a relay of mine
 */
export const announcementRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = (app as any).redis;

  app.post(
    '/channels/relay/:relayId/transmissions/:transmissionId/publish',
    { schema: { params: { type: 'object', properties: { relayId: ID, transmissionId: ID } } } },
    async (request, reply) => {
      const token = extractAuthToken(request) as any;
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { relayId, transmissionId } = request.params as { relayId: string; transmissionId: string };
      const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
      if (!relay) return reply.status(404).send({ error: 'Relay not found' });
      const actor = await resolveRelayActorContext(db, token.transmitterId, relay);
      if (!actor || !hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY)) return reply.status(404).send({ error: 'Relay not found' });
      if (!relay.isAnnouncement) return reply.status(400).send({ error: 'Only announcement relays publish', code: 'NOT_ANNOUNCEMENT' });
      const [t] = await db.select().from(transmissions).where(and(eq(transmissions.id, transmissionId), eq(transmissions.relayId, relayId))).limit(1);
      if (!t) return reply.status(404).send({ error: 'Transmission not found' });
      if (t.publishedAt) return reply.status(409).send({ error: 'Already published', code: 'ALREADY_PUBLISHED' });
      if (!['default', 'reply'].includes(t.type) || t.encryptedPayload || t.poll) return reply.status(400).send({ error: 'This transmission cannot be published', code: 'NOT_PUBLISHABLE' });
      // Your own (if you can post here), anyone's with Manage Transmissions.
      const own = t.transmitterId === token.transmitterId && hasPermission(actor.effectivePermissions, PERMISSIONS.SEND_TRANSMISSIONS);
      if (!own && !hasPermission(actor.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS)) {
        return reply.status(403).send({ error: 'Transmitter lacks MANAGE_TRANSMISSIONS clearance', code: 'MISSING_PERMISSIONS' });
      }
      if (!(await checkRateLimit(redis, `rl:publish:${relayId}`, PUBLISHES_PER_HOUR, 3600))) {
        return reply.status(429).send({ error: `An announcement relay can publish ${PUBLISHES_PER_HOUR} times an hour`, code: 'RATE_LIMITED' });
      }

      // Only the first of several concurrent publishes goes through.
      const [published] = await db.update(transmissions).set({ publishedAt: new Date() }).where(and(eq(transmissions.id, t.id), isNull(transmissions.publishedAt))).returning();
      if (!published) return reply.status(409).send({ error: 'Already published', code: 'ALREADY_PUBLISHED' });
      const channel = await loadChannel(db, 'relay', relayId);
      const formatted = await formatTransmission(db, published, published.transmitterId, { beaconId: relay.beaconId });
      await publishGatewayEvent(app, 'TRANSMISSION_UPDATE', { channelType: 'relay', channelId: relayId, transmission: formatted }, audienceForChannel(channel!));

      // A copy in every relay that follows this one. One that fails does not stop the others.
      const [beacon] = await db.select({ name: beacons.name, iconUrl: beacons.iconUrl }).from(beacons).where(eq(beacons.id, relay.beaconId)).limit(1);
      const followers = await db.select().from(webhooks).where(eq(webhooks.sourceRelayId, relayId));
      let delivered = 0;
      for (const w of followers) {
        try {
          const target = await loadChannel(db, 'relay', w.relayId);
          if (!target) continue;
          await postAppMessage(app, {
            channel: target,
            authorId: w.authorId,
            content: t.content,
            embeds: (t.embeds ?? []).filter((e: any) => e?.type === 'rich'),
            attachments: t.attachments ?? [],
            override: { name: sourceName(beacon?.name ?? 'Beacon', relay.name), avatarUrl: beacon?.iconUrl ?? null },
            webhookId: w.id,
            crosspost: { beaconId: relay.beaconId, beaconName: beacon?.name ?? '', relayId, relayName: relay.name, transmissionId: t.id },
          });
          delivered++;
        } catch (err) {
          request.log.warn({ err, webhookId: w.id }, 'publishing to a follower failed');
        }
      }
      return reply.send({ transmission: formatted, delivered });
    }
  );

  app.post(
    '/relays/:relayId/followers',
    {
      schema: {
        params: { type: 'object', properties: { relayId: ID } },
        body: { type: 'object', additionalProperties: false, required: ['targetRelayId'], properties: { targetRelayId: ID } },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request) as any;
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      if (token.bot) return reply.status(403).send({ error: 'Bots cannot follow relays', code: 'BOT_FORBIDDEN' });
      const { relayId } = request.params as { relayId: string };
      const { targetRelayId } = request.body as { targetRelayId: string };
      if (relayId === targetRelayId) return reply.status(400).send({ error: 'A relay cannot follow itself', code: 'SAME_RELAY' });

      const [source] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
      if (!source || !hasPermission(await computeRelayPermissions(db, token.transmitterId, relayId), PERMISSIONS.VIEW_RELAY)) return reply.status(404).send({ error: 'Relay not found' });
      if (!source.isAnnouncement) return reply.status(400).send({ error: 'Only announcement relays can be followed', code: 'NOT_ANNOUNCEMENT' });

      const [target] = await db.select().from(relays).where(eq(relays.id, targetRelayId)).limit(1);
      if (!target || target.type !== 'text') return reply.status(404).send({ error: 'Pick a text relay to post them in', code: 'UNKNOWN_TARGET' });
      const actor = await resolveRelayActorContext(db, token.transmitterId, target);
      if (!actor || !hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY)) return reply.status(404).send({ error: 'Pick a text relay to post them in', code: 'UNKNOWN_TARGET' });
      if (!hasPermission(actor.effectivePermissions, PERMISSIONS.MANAGE_WEBHOOKS)) return reply.status(403).send({ error: 'You need Manage Webhooks in that relay', code: 'MISSING_PERMISSIONS' });

      const [already] = await db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.relayId, targetRelayId), eq(webhooks.sourceRelayId, relayId))).limit(1);
      if (already) return reply.status(409).send({ error: 'That relay already follows this one', code: 'ALREADY_FOLLOWING' });
      const existing = await db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.beaconId, target.beaconId));
      if (existing.length >= MAX_WEBHOOKS_PER_BEACON) return reply.status(400).send({ error: `A beacon can have ${MAX_WEBHOOKS_PER_BEACON} webhooks`, code: 'WEBHOOK_LIMIT' });

      const [beacon] = await db.select({ name: beacons.name, iconUrl: beacons.iconUrl }).from(beacons).where(eq(beacons.id, source.beaconId)).limit(1);
      const name = sourceName(beacon?.name ?? 'Beacon', source.name);
      const authorId = await createAppUser(db, 'webhook', name, beacon?.iconUrl ?? null);
      // Its token is never shown: a follower webhook only carries what the relay publishes.
      const [w] = await db
        .insert(webhooks)
        .values({ beaconId: target.beaconId, relayId: target.id, authorId, name, avatarUrl: beacon?.iconUrl ?? null, tokenHash: hashSecret(newSecret()), creatorId: token.transmitterId, sourceRelayId: relayId })
        .returning();
      await audit(db, { beaconId: target.beaconId, actorId: token.transmitterId, action: 'webhook_create', targetType: 'webhook', targetId: w.id, targetName: `Following ${name}` });
      return reply.status(201).send({ webhook: { id: w.id, beaconId: w.beaconId, relayId: w.relayId, name: w.name, avatarUrl: w.avatarUrl, sourceRelayId: w.sourceRelayId, createdAt: w.createdAt } });
    }
  );
};
