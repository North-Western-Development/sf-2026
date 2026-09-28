import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  relays,
  clearances,
  relayOverwrites,
  computeRelayPermissions,
  resolveRelayAudience,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';

/**
 * Relay permission overwrites (section 1 of the parity contract).
 * `GET/PUT/DELETE /beacons/:beaconId/relays/:relayId/overwrites[/:targetId]`
 */
export const relayOverwriteRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function loadRelay(beaconId: string, relayId: string) {
    const [relay] = await db
      .select()
      .from(relays)
      .where(and(eq(relays.id, relayId), eq(relays.beaconId, beaconId)))
      .limit(1);
    return relay || null;
  }

  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { beaconId, relayId } = request.params as { beaconId: string; relayId: string };
    const relay = await loadRelay(beaconId, relayId);
    if (!relay) return reply.status(404).send({ error: 'Relay not found' });

    const actorPerms = await computeRelayPermissions(db, token.transmitterId, relayId);
    if (!hasPermission(actorPerms, PERMISSIONS.MANAGE_CLEARANCES)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance on this Relay' });
    }

    const rows = await db.select().from(relayOverwrites).where(eq(relayOverwrites.relayId, relayId));
    return reply.send({
      overwrites: rows.map((o: any) => ({
        targetId: o.targetId,
        targetType: o.targetType,
        allow: o.allowBits.toString(),
        deny: o.denyBits.toString(),
      })),
    });
  });

  app.put(
    '/:targetId',
    {
      schema: {
        params: {
          type: 'object',
          properties: { beaconId: { type: 'string' }, relayId: { type: 'string' }, targetId: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['targetType'],
          properties: {
            targetType: { type: 'string', enum: ['clearance', 'transmitter'] },
            allow: { type: 'string' },
            deny: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { beaconId, relayId, targetId } = request.params as {
        beaconId: string;
        relayId: string;
        targetId: string;
      };
      const relay = await loadRelay(beaconId, relayId);
      if (!relay) return reply.status(404).send({ error: 'Relay not found' });

      const actorPerms = await computeRelayPermissions(db, token.transmitterId, relayId);
      if (!hasPermission(actorPerms, PERMISSIONS.MANAGE_CLEARANCES)) {
        return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance on this Relay' });
      }

      const { targetType, allow, deny } = request.body as { targetType: string; allow?: string; deny?: string };

      let allowBits = 0n;
      let denyBits = 0n;
      try {
        if (allow !== undefined) allowBits = BigInt(allow);
        if (deny !== undefined) denyBits = BigInt(deny);
      } catch {
        return reply.status(400).send({ error: 'allow/deny must be decimal bitfield strings' });
      }
      if (allowBits < 0n || denyBits < 0n) {
        return reply.status(400).send({ error: 'allow/deny must be non-negative' });
      }

      // Hierarchy: cannot grant/deny a permission bit you do not hold yourself.
      if (!hasPermission(actorPerms, PERMISSIONS.ADMINISTRATOR)) {
        const requested = allowBits | denyBits;
        if ((requested & ~actorPerms) !== 0n) {
          return reply.status(403).send({
            error: 'Cannot grant or deny a permission bit you do not hold',
            code: 'FORBIDDEN_HIERARCHY',
          });
        }
      }

      if (targetType === 'clearance') {
        const [clearance] = await db
          .select()
          .from(clearances)
          .where(and(eq(clearances.id, targetId), eq(clearances.beaconId, beaconId)))
          .limit(1);
        if (!clearance) return reply.status(404).send({ error: 'Clearance not found in this Beacon' });
      }

      const beforeAudience = await resolveRelayAudience(db, relayId);

      const [existing] = await db
        .select()
        .from(relayOverwrites)
        .where(and(eq(relayOverwrites.relayId, relayId), eq(relayOverwrites.targetId, targetId)))
        .limit(1);

      let overwrite;
      if (existing) {
        [overwrite] = await db
          .update(relayOverwrites)
          .set({ targetType, allowBits, denyBits })
          .where(eq(relayOverwrites.id, existing.id))
          .returning();
      } else {
        [overwrite] = await db
          .insert(relayOverwrites)
          .values({ relayId, targetId, targetType, allowBits, denyBits })
          .returning();
      }

      const afterAudience = await resolveRelayAudience(db, relayId);
      const combinedAudience = [...new Set([...beforeAudience, ...afterAudience])];

      await publishGatewayEvent(
        app,
        'RELAY_UPDATE',
        { beaconId, relay: { ...relay, permissionsSynced: relay.permissionsSynced } },
        { transmitterIds: combinedAudience }
      );

      return reply.send({
        overwrite: {
          targetId: overwrite.targetId,
          targetType: overwrite.targetType,
          allow: overwrite.allowBits.toString(),
          deny: overwrite.denyBits.toString(),
        },
      });
    }
  );

  app.delete('/:targetId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { beaconId, relayId, targetId } = request.params as {
      beaconId: string;
      relayId: string;
      targetId: string;
    };
    const relay = await loadRelay(beaconId, relayId);
    if (!relay) return reply.status(404).send({ error: 'Relay not found' });

    const actorPerms = await computeRelayPermissions(db, token.transmitterId, relayId);
    if (!hasPermission(actorPerms, PERMISSIONS.MANAGE_CLEARANCES)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance on this Relay' });
    }

    const beforeAudience = await resolveRelayAudience(db, relayId);

    await db
      .delete(relayOverwrites)
      .where(and(eq(relayOverwrites.relayId, relayId), eq(relayOverwrites.targetId, targetId)));

    const afterAudience = await resolveRelayAudience(db, relayId);
    const combinedAudience = [...new Set([...beforeAudience, ...afterAudience])];

    await publishGatewayEvent(app, 'RELAY_UPDATE', { beaconId, relay }, { transmitterIds: combinedAudience });

    return reply.send({ message: 'Overwrite removed' });
  });
};
