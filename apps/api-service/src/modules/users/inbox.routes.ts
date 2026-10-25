import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, or, lt, desc, ne, inArray, sql, beaconMembers, beacons, relays, transmissions, pointToPointLinks, subspaceMeshMembers } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { formatTransmission } from '../../lib/transmissions.js';

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
};
