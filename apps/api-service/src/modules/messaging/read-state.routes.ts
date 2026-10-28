import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  or,
  sql,
  relays,
  archivalThreads,
  pointToPointLinks,
  subspaceMeshes,
  subspaceMeshMembers,
  beaconMembers,
  readStates,
  notificationSettings,
  canSeeThread,
  transmissions,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { CHANNEL_TYPES, loadChannel, checkChannelAccess } from '../../lib/channels.js';

/** Which transmissions column holds each kind of channel. */
const CHANNEL_COLUMN = { relay: 'relayId', thread: 'threadId', link: 'p2pLinkId', mesh: 'meshId' } as const;
import { resolveTransmitterBeaconIds, computeRelayPermissions } from '@subspace/database';

const SCOPE_TYPES = ['global', 'beacon', 'category', 'relay', 'link', 'mesh'];
const LEVELS = ['all', 'mentions', 'nothing', 'inherit'];

export const readStateRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/read-states
   */
  app.get('/read-states', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const beaconIds = await resolveTransmitterBeaconIds(db, token.transmitterId);

    const channels: Array<{ channelType: string; channelId: string; beaconId?: string; lastTransmissionId: string | null; lastTransmissionAt: string | null }> = [];

    if (beaconIds.length > 0) {
      const allRelays = await db.select().from(relays).where(or(...beaconIds.map((id: string) => eq(relays.beaconId, id))));
      for (const relay of allRelays) {
        const actorContext = await resolveRelayActorContext(db, token.transmitterId, relay);
        if (actorContext && hasPermission(actorContext.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
          channels.push({
            channelType: 'relay',
            channelId: relay.id,
            beaconId: relay.beaconId,
            lastTransmissionId: relay.lastTransmissionId,
            lastTransmissionAt: relay.lastTransmissionAt,
          });
        }
      }
      const relayIds = allRelays.map((r: any) => r.id);
      if (relayIds.length > 0) {
        const threads = await db.select().from(archivalThreads).where(or(...relayIds.map((id: string) => eq(archivalThreads.relayId, id))));
        for (const thread of threads) {
          const parentRelay = allRelays.find((r: any) => r.id === thread.relayId);
          if (!parentRelay) continue;
          const actorContext = await resolveRelayActorContext(db, token.transmitterId, parentRelay);
          if (thread.isPrivate && !(await canSeeThread(db, token.transmitterId, thread))) continue;
          if (actorContext && hasPermission(actorContext.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
            channels.push({
              channelType: 'thread',
              channelId: thread.id,
              beaconId: parentRelay.beaconId,
              lastTransmissionId: thread.lastTransmissionId,
              lastTransmissionAt: thread.lastTransmissionAt,
            });
          }
        }
      }
    }

    const links = await db
      .select()
      .from(pointToPointLinks)
      .where(or(eq(pointToPointLinks.transmitter1Id, token.transmitterId), eq(pointToPointLinks.transmitter2Id, token.transmitterId)));
    for (const link of links) {
      channels.push({ channelType: 'link', channelId: link.id, lastTransmissionId: link.lastTransmissionId, lastTransmissionAt: link.lastTransmissionAt });
    }

    const meshMemberships = await db.select().from(subspaceMeshMembers).where(eq(subspaceMeshMembers.transmitterId, token.transmitterId));
    if (meshMemberships.length > 0) {
      const meshes = await db
        .select()
        .from(subspaceMeshes)
        .where(or(...meshMemberships.map((m: any) => eq(subspaceMeshes.id, m.meshId))));
      for (const mesh of meshes) {
        channels.push({ channelType: 'mesh', channelId: mesh.id, lastTransmissionId: mesh.lastTransmissionId, lastTransmissionAt: mesh.lastTransmissionAt });
      }
    }

    const stateRows = await db.select().from(readStates).where(eq(readStates.transmitterId, token.transmitterId));
    const stateMap = new Map(stateRows.map((r: any) => [`${r.channelType}:${r.channelId}`, r]));

    const readStatesOut = channels.map((c) => {
      const row: any = stateMap.get(`${c.channelType}:${c.channelId}`);
      return {
        channelType: c.channelType,
        channelId: c.channelId,
        lastReadId: row?.lastReadId ?? null,
        lastReadAt: row?.lastReadAt ?? null,
        mentionCount: row?.mentionCount ?? 0,
      };
    });

    return reply.send({ readStates: readStatesOut, channels });
  });

  /**
   * POST /api/v1/channels/:channelType/:channelId/ack
   */
  app.post(
    '/channels/:channelType/:channelId/ack',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['channelType', 'channelId'],
          properties: { channelType: { type: 'string', enum: CHANNEL_TYPES }, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['transmissionId'],
          properties: { transmissionId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { channelType, channelId } = request.params as { channelType: string; channelId: string };
      const { transmissionId } = request.body as { transmissionId: string };

      const channel = await loadChannel(db, channelType, channelId);
      if (!channel) return reply.status(404).send({ error: 'Channel not found or not visible' });
      const access = await checkChannelAccess(db, channel, token.transmitterId, 'view');
      if (!access.allowed) return reply.status(access.status).send({ error: access.error });

      const now = new Date();
      await db
        .insert(readStates)
        .values({ transmitterId: token.transmitterId, channelType, channelId, lastReadId: transmissionId, lastReadAt: now, mentionCount: 0 })
        .onConflictDoUpdate({
          target: [readStates.transmitterId, readStates.channelType, readStates.channelId],
          set: { lastReadId: transmissionId, lastReadAt: now, mentionCount: 0 },
        });

      await publishGatewayEvent(
        app,
        'READ_STATE_UPDATE',
        { channelType, channelId, lastReadId: transmissionId, lastReadAt: now.toISOString(), mentionCount: 0 },
        { transmitterIds: [token.transmitterId] }
      );

      return reply.send({ message: 'Acknowledged' });
    }
  );

  /**
   * POST /api/v1/channels/:channelType/:channelId/unread  { transmissionId }
   * Mark Unread (Discord's): that transmission and everything after it become unread again, with
   * the mentions among them counted again.
   */
  app.post(
    '/channels/:channelType/:channelId/unread',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['channelType', 'channelId'],
          properties: { channelType: { type: 'string', enum: CHANNEL_TYPES }, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
        body: { type: 'object', additionalProperties: false, required: ['transmissionId'], properties: { transmissionId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { channelType, channelId } = request.params as { channelType: keyof typeof CHANNEL_COLUMN; channelId: string };
      const { transmissionId } = request.body as { transmissionId: string };

      const channel = await loadChannel(db, channelType, channelId);
      if (!channel) return reply.status(404).send({ error: 'Channel not found or not visible' });
      const access = await checkChannelAccess(db, channel, token.transmitterId, 'view');
      if (!access.allowed) return reply.status(access.status).send({ error: access.error });

      const column = (transmissions as any)[CHANNEL_COLUMN[channelType]];
      const [target] = await db.select({ id: transmissions.id }).from(transmissions).where(and(eq(transmissions.id, transmissionId), eq(column, channelId))).limit(1);
      if (!target) return reply.status(404).send({ error: 'Transmission not found' });
      // Read up to the one before it (none: the whole channel is unread).
      const [previous] = await db
        .select({ id: transmissions.id, createdAt: transmissions.createdAt })
        .from(transmissions)
        .where(and(eq(column, channelId), sql`${transmissions.id} < ${transmissionId}`))
        .orderBy(sql`${transmissions.id} desc`)
        .limit(1);
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(transmissions)
        .where(
          and(
            eq(column, channelId),
            sql`${transmissions.id} >= ${transmissionId}`,
            sql`${transmissions.transmitterId} <> ${token.transmitterId}`,
            sql`(${transmissions.mentions} @> ${JSON.stringify([token.transmitterId])}::jsonb or ${transmissions.mentionEveryone})`
          )
        );
      const lastReadId = previous?.id ?? null;
      const lastReadAt = previous?.createdAt ?? new Date(0);
      await db
        .insert(readStates)
        .values({ transmitterId: token.transmitterId, channelType, channelId, lastReadId, lastReadAt, mentionCount: n })
        .onConflictDoUpdate({ target: [readStates.transmitterId, readStates.channelType, readStates.channelId], set: { lastReadId, lastReadAt, mentionCount: n } });
      await publishGatewayEvent(
        app,
        'READ_STATE_UPDATE',
        { channelType, channelId, lastReadId, lastReadAt: new Date(lastReadAt).toISOString(), mentionCount: n, manual: true },
        { transmitterIds: [token.transmitterId] }
      );
      return reply.send({ lastReadId, mentionCount: n });
    }
  );

  /**
   * POST /api/v1/beacons/:beaconId/ack
   */
  app.post('/beacons/:beaconId/ack', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { beaconId } = request.params as { beaconId: string };
    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });

    const allRelays = await db.select().from(relays).where(eq(relays.beaconId, beaconId));
    const now = new Date();
    const acked: string[] = [];

    for (const relay of allRelays) {
      if (!hasPermission(await computeRelayPermissions(db, token.transmitterId, relay.id), PERMISSIONS.VIEW_RELAY)) continue;
      const lastId = relay.lastTransmissionId;
      await db
        .insert(readStates)
        .values({ transmitterId: token.transmitterId, channelType: 'relay', channelId: relay.id, lastReadId: lastId, lastReadAt: now, mentionCount: 0 })
        .onConflictDoUpdate({
          target: [readStates.transmitterId, readStates.channelType, readStates.channelId],
          set: { lastReadId: lastId, lastReadAt: now, mentionCount: 0 },
        });
      acked.push(relay.id);

      const threads = await db.select().from(archivalThreads).where(eq(archivalThreads.relayId, relay.id));
      for (const thread of threads) {
        await db
          .insert(readStates)
          .values({ transmitterId: token.transmitterId, channelType: 'thread', channelId: thread.id, lastReadId: thread.lastTransmissionId, lastReadAt: now, mentionCount: 0 })
          .onConflictDoUpdate({
            target: [readStates.transmitterId, readStates.channelType, readStates.channelId],
            set: { lastReadId: thread.lastTransmissionId, lastReadAt: now, mentionCount: 0 },
          });
      }
    }

    await publishGatewayEvent(app, 'READ_STATE_UPDATE', { beaconId, ackedAt: now.toISOString() }, { transmitterIds: [token.transmitterId] });

    return reply.send({ message: 'Beacon acknowledged', relayIds: acked });
  });

  /**
   * GET /api/v1/notification-settings
   */
  app.get('/notification-settings', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const settings = await db.select().from(notificationSettings).where(eq(notificationSettings.transmitterId, token.transmitterId));
    return reply.send({ settings });
  });

  /**
   * PUT /api/v1/notification-settings/:scopeType/:scopeId
   */
  app.put(
    '/notification-settings/:scopeType/:scopeId',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['scopeType', 'scopeId'],
          properties: { scopeType: { type: 'string', enum: SCOPE_TYPES }, scopeId: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            level: { type: 'string', enum: LEVELS },
            mutedUntil: { type: ['string', 'null'] },
            suppressEveryone: { type: 'boolean' },
            suppressRoles: { type: 'boolean' },
            suppressHighlights: { type: 'boolean' },
            mobilePush: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { scopeType, scopeId } = request.params as { scopeType: string; scopeId: string };
      const body = request.body as any;

      let mutedUntil: Date | null | undefined = undefined;
      if (body.mutedUntil === null) mutedUntil = null;
      else if (typeof body.mutedUntil === 'string') {
        mutedUntil = body.mutedUntil === 'infinity' ? new Date('9999-12-31T00:00:00.000Z') : new Date(body.mutedUntil);
        if (isNaN(mutedUntil.getTime())) return reply.status(400).send({ error: 'Invalid mutedUntil' });
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.level !== undefined) updates.level = body.level;
      if (mutedUntil !== undefined) updates.mutedUntil = mutedUntil;
      if (body.suppressEveryone !== undefined) updates.suppressEveryone = body.suppressEveryone;
      if (body.suppressRoles !== undefined) updates.suppressRoles = body.suppressRoles;
      if (body.suppressHighlights !== undefined) updates.suppressHighlights = body.suppressHighlights;
      if (body.mobilePush !== undefined) updates.mobilePush = body.mobilePush;

      const [row] = await db
        .insert(notificationSettings)
        .values({
          transmitterId: token.transmitterId,
          scopeType,
          scopeId,
          level: body.level || 'inherit',
          mutedUntil: mutedUntil ?? null,
          suppressEveryone: body.suppressEveryone ?? false,
          suppressRoles: body.suppressRoles ?? false,
          suppressHighlights: body.suppressHighlights ?? false,
          mobilePush: body.mobilePush ?? true,
        })
        .onConflictDoUpdate({
          target: [notificationSettings.transmitterId, notificationSettings.scopeType, notificationSettings.scopeId],
          set: updates,
        })
        .returning();

      await publishGatewayEvent(app, 'NOTIFICATION_SETTINGS_UPDATE', { setting: row }, { transmitterIds: [token.transmitterId] });

      return reply.send({ setting: row });
    }
  );

  /**
   * DELETE /api/v1/notification-settings/:scopeType/:scopeId
   */
  app.delete('/notification-settings/:scopeType/:scopeId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { scopeType, scopeId } = request.params as { scopeType: string; scopeId: string };
    await db
      .delete(notificationSettings)
      .where(and(eq(notificationSettings.transmitterId, token.transmitterId), eq(notificationSettings.scopeType, scopeType), eq(notificationSettings.scopeId, scopeId)));

    await publishGatewayEvent(app, 'NOTIFICATION_SETTINGS_UPDATE', { scopeType, scopeId, reset: true }, { transmitterIds: [token.transmitterId] });

    return reply.send({ message: 'Reset to inherit' });
  });
};
