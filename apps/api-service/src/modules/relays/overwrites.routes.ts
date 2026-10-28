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
 * Relay and Frequency Band permission overwrites (Discord's channel and category permissions).
 *   GET    /beacons/:beaconId/relays/:relayId/overwrites            the ones in effect, and whether synced
 *   PUT    /beacons/:beaconId/relays/:relayId/overwrites/:targetId  { targetType, allow, deny }
 *   DELETE /beacons/:beaconId/relays/:relayId/overwrites/:targetId
 *   POST   /beacons/:beaconId/relays/:relayId/overwrites/sync       back to the band's permissions
 * A relay in a band starts synced: it uses the band's overwrites. Changing a synced relay's
 * permissions first copies the band's onto it and un-syncs it, as Discord does, so the change
 * applies to that relay alone (before this, the change was saved but ignored).
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

  /** A relay in a band that uses the band's overwrites. */
  const isSynced = (relay: any) => relay.type !== 'category' && !!relay.parentId && relay.permissionsSynced;

  /** Give a synced relay its own copy of the band's overwrites, and stop following the band. */
  async function unsync(relay: any) {
    if (!isSynced(relay)) return;
    const parent = await db.select().from(relayOverwrites).where(eq(relayOverwrites.relayId, relay.parentId));
    await db.delete(relayOverwrites).where(eq(relayOverwrites.relayId, relay.id));
    if (parent.length) {
      await db.insert(relayOverwrites).values(parent.map((o: any) => ({ relayId: relay.id, targetId: o.targetId, targetType: o.targetType, allowBits: o.allowBits, denyBits: o.denyBits })));
    }
    await db.update(relays).set({ permissionsSynced: false, updatedAt: new Date() }).where(eq(relays.id, relay.id));
    relay.permissionsSynced = false;
  }

  /**
   * Tell clients to reload: a band's change reaches every relay synced to it, so the whole beacon
   * hears it; a relay's, whoever could see it before or after.
   */
  async function announce(beaconId: string, relay: any, beforeAudience: string[]) {
    if (relay.type === 'category') {
      await publishGatewayEvent(app, 'RELAY_UPDATE', { beaconId, relay }, { beaconId });
      return;
    }
    const afterAudience = await resolveRelayAudience(db, relay.id);
    await publishGatewayEvent(app, 'RELAY_UPDATE', { beaconId, relay }, { transmitterIds: [...new Set([...beforeAudience, ...afterAudience])] });
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

    // A synced relay shows the band's overwrites: they are the ones in effect.
    const source = isSynced(relay) ? relay.parentId : relayId;
    const rows = await db.select().from(relayOverwrites).where(eq(relayOverwrites.relayId, source));
    return reply.send({
      synced: isSynced(relay),
      parentId: relay.type === 'category' ? null : relay.parentId ?? null,
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
      await unsync(relay);

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

      await announce(beaconId, relay, beforeAudience);

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
    await unsync(relay);

    await db
      .delete(relayOverwrites)
      .where(and(eq(relayOverwrites.relayId, relayId), eq(relayOverwrites.targetId, targetId)));

    await announce(beaconId, relay, beforeAudience);

    return reply.send({ message: 'Overwrite removed' });
  });

  app.post('/sync', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { beaconId, relayId } = request.params as { beaconId: string; relayId: string };
    const relay = await loadRelay(beaconId, relayId);
    if (!relay) return reply.status(404).send({ error: 'Relay not found' });
    if (relay.type === 'category' || !relay.parentId) return reply.status(400).send({ error: 'Only a relay in a band can sync with it', code: 'NO_BAND' });
    const actorPerms = await computeRelayPermissions(db, token.transmitterId, relayId);
    if (!hasPermission(actorPerms, PERMISSIONS.MANAGE_CLEARANCES)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance on this Relay' });
    }
    const beforeAudience = await resolveRelayAudience(db, relayId);
    // Its own overwrites go; the band's apply from now on.
    await db.delete(relayOverwrites).where(eq(relayOverwrites.relayId, relayId));
    await db.update(relays).set({ permissionsSynced: true, updatedAt: new Date() }).where(eq(relays.id, relayId));
    relay.permissionsSynced = true;
    await announce(beaconId, relay, beforeAudience);
    return reply.send({ synced: true });
  });
};
