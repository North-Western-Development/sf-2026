import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  or,
  ilike,
  desc,
  asc,
  sql,
  beacons,
  beaconMembers,
  relays,
  transmitters,
  transmissions,
  signalBlacklist,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';

export const searchRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/search/quick-scan
   * Subspace Quick Scan (Ctrl+K): Global quick find across joined Beacons, Relays, and Transmitters
   */
  app.get('/quick-scan', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const query = request.query as any;
    const q = typeof query.q === 'string' ? query.q.trim() : '';

    if (!q) {
      return reply.send({
        beacons: [],
        relays: [],
        transmitters: [],
      });
    }

    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const searchPattern = `%${q}%`;

    // 1. Find joined beacons matching query
    const matchedBeacons = await db
      .select({
        id: beacons.id,
        name: beacons.name,
        iconUrl: beacons.iconUrl,
        description: beacons.description,
      })
      .from(beacons)
      .innerJoin(beaconMembers, eq(beacons.id, beaconMembers.beaconId))
      .where(
        and(
          eq(beaconMembers.transmitterId, token.transmitterId),
          ilike(beacons.name, searchPattern)
        )
      )
      .limit(10);

    // 2. Find relays in joined beacons matching query
    const joinedBeaconIds = (
      await db
        .select({ beaconId: beaconMembers.beaconId })
        .from(beaconMembers)
        .where(eq(beaconMembers.transmitterId, token.transmitterId))
    ).map((b: any) => b.beaconId);

    let matchedRelays: any[] = [];
    if (joinedBeaconIds.length > 0) {
      const allCandidateRelays = await db
        .select({
          id: relays.id,
          beaconId: relays.beaconId,
          name: relays.name,
          type: relays.type,
          topic: relays.topic,
          beaconName: beacons.name,
        })
        .from(relays)
        .innerJoin(beacons, eq(relays.beaconId, beacons.id))
        .where(
          and(
            sql`${relays.beaconId} IN ${joinedBeaconIds}`,
            ilike(relays.name, searchPattern)
          )
        )
        .limit(20);

      // Filter by VIEW_RELAY permission
      for (const r of allCandidateRelays) {
        const actorCtx = await resolveBeaconActorContext(db, token.transmitterId, r.beaconId);
        if (actorCtx && hasPermission(actorCtx.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
          matchedRelays.push(r);
          if (matchedRelays.length >= 10) break;
        }
      }
    }

    // 3. Find Transmitters matching query
    const matchedTransmitters = await db
      .select({
        id: transmitters.id,
        username: transmitters.username,
        displayName: transmitters.displayName,
        avatarUrl: transmitters.avatarUrl,
        presence: transmitters.presence,
      })
      .from(transmitters)
      .where(
        or(
          ilike(transmitters.username, searchPattern),
          ilike(transmitters.displayName, searchPattern)
        )
      )
      .limit(10);

    return reply.send({
      query: q,
      beacons: matchedBeacons,
      relays: matchedRelays,
      transmitters: matchedTransmitters,
    });
  });

  /**
   * GET /api/v1/search/transmissions
   * Subspace Deep Search: Full-text transmission search with date, user, and relay filters.
   */
  app.get('/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const query = request.query as any;
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    const { beaconId, relayId, transmitterId, hasAttachment, before, after } = query;

    if (!q) {
      return reply.status(400).send({ error: 'Search query parameter (q) is required' });
    }

    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    // Enforce membership / access scope
    const joinedBeaconRecords = await db
      .select({ beaconId: beaconMembers.beaconId })
      .from(beaconMembers)
      .where(eq(beaconMembers.transmitterId, token.transmitterId));

    const accessibleBeaconIds = joinedBeaconRecords.map((b: any) => b.beaconId);
    if (accessibleBeaconIds.length === 0) {
      return reply.send({ count: 0, transmissions: [] });
    }

    // Determine target relay IDs
    let targetRelayQuery = db
      .select({ id: relays.id, beaconId: relays.beaconId })
      .from(relays)
      .where(sql`${relays.beaconId} IN ${accessibleBeaconIds}`);

    if (beaconId) {
      if (!accessibleBeaconIds.includes(beaconId)) {
        return reply.status(403).send({ error: 'Transmitter is not a member of the requested Beacon' });
      }
      targetRelayQuery = targetRelayQuery.where(eq(relays.beaconId, beaconId));
    }

    if (relayId) {
      targetRelayQuery = targetRelayQuery.where(eq(relays.id, relayId));
    }

    const candidateRelays = await targetRelayQuery;
    const allowedRelayIds: string[] = [];

    for (const r of candidateRelays) {
      const actorCtx = await resolveBeaconActorContext(db, token.transmitterId, r.beaconId);
      if (actorCtx && hasPermission(actorCtx.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
        allowedRelayIds.push(r.id);
      }
    }

    if (allowedRelayIds.length === 0) {
      return reply.send({ count: 0, transmissions: [] });
    }

    // Get blocklist for caller to exclude blocked transmitters
    const blocks = await db
      .select()
      .from(signalBlacklist)
      .where(
        and(
          eq(signalBlacklist.transmitterId, token.transmitterId),
          eq(signalBlacklist.targetType, 'transmitter')
        )
      );
    const blockedTransmitterIds = new Set(blocks.map((b: any) => b.targetId));

    // Construct full-text / ILIKE search conditions
    const searchPattern = `%${q}%`;

    const records = await db
      .select({
        transmission: transmissions,
        author: {
          id: transmitters.id,
          username: transmitters.username,
          displayName: transmitters.displayName,
          avatarUrl: transmitters.avatarUrl,
        },
        relayName: relays.name,
      })
      .from(transmissions)
      .innerJoin(transmitters, eq(transmissions.transmitterId, transmitters.id))
      .innerJoin(relays, eq(transmissions.relayId, relays.id))
      .where(
        and(
          sql`${transmissions.relayId} IN ${allowedRelayIds}`,
          or(
            sql`to_tsvector('english', ${transmissions.content}) @@ plainto_tsquery('english', ${q})`,
            ilike(transmissions.content, searchPattern)
          ),
          transmitterId ? eq(transmissions.transmitterId, transmitterId) : sql`1=1`,
          before ? sql`${transmissions.createdAt} < ${new Date(before)}` : sql`1=1`,
          after ? sql`${transmissions.createdAt} > ${new Date(after)}` : sql`1=1`
        )
      )
      .orderBy(desc(transmissions.createdAt))
      .limit(50);

    // Filter blocked transmitters & attachment filter if requested
    const filtered = records
      .filter((r: any) => !blockedTransmitterIds.has(r.author.id))
      .filter((r: any) => {
        if (hasAttachment === 'true') {
          return Array.isArray(r.transmission.attachments) && r.transmission.attachments.length > 0;
        }
        return true;
      });

    return reply.send({
      query: q,
      count: filtered.length,
      transmissions: filtered,
    });
  });
};
