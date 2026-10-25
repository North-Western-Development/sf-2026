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
  archivalThreads,
  pointToPointLinks,
  subspaceMeshes,
  subspaceMeshMembers,
  inArray,
  notInArray,
  isNotNull,
  lt,
  gt,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { formatTransmission } from '../../lib/transmissions.js';

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
        const actorCtx = await resolveRelayActorContext(db, token.transmitterId, r);
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
   * Deep Search. Scope is one beacon (`beaconId`) or every DM and mesh (`scope=dms`); with
   * neither, every beacon the caller can read. Filters: q (text), from, mentions (transmitter
   * ids), relayId, has (link | file | image | video), pinned, before/after (ISO dates),
   * sort (newest | oldest), offset, limit. Results the caller cannot see never leave the query.
   */
  app.get(
    '/transmissions',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 200 },
            scope: { type: 'string', enum: ['beacons', 'dms'] },
            beaconId: { type: 'string', format: 'uuid' },
            relayId: { type: 'string', format: 'uuid' },
            from: { type: 'string', format: 'uuid' },
            transmitterId: { type: 'string', format: 'uuid' },
            mentions: { type: 'string', format: 'uuid' },
            has: { type: 'string', enum: ['link', 'file', 'image', 'video'] },
            hasAttachment: { type: 'string', enum: ['true', 'false'] },
            pinned: { type: 'string', enum: ['true', 'false'] },
            before: { type: 'string', format: 'date-time' },
            after: { type: 'string', format: 'date-time' },
            sort: { type: 'string', enum: ['newest', 'oldest'] },
            offset: { type: 'string', pattern: '^[0-9]{1,4}$' },
            limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const query = request.query as Record<string, string | undefined>;
      const q = (query.q || '').trim();
      const from = query.from || query.transmitterId;
      const has = query.has || (query.hasAttachment === 'true' ? 'file' : undefined);
      if (!q && !from && !query.mentions && !has && query.pinned !== 'true') {
        return reply.status(400).send({ error: 'Give a search term or at least one filter', code: 'SEARCH_EMPTY' });
      }
      const limit = Math.max(1, Math.min(50, parseInt(query.limit || '25', 10)));
      const offset = Math.min(5000, parseInt(query.offset || '0', 10));

      // Every container the caller may read, with a label for the result header.
      const channelInfo = new Map<string, SearchChannel>();
      const containerConds: any[] = [];

      if (query.scope === 'dms') {
        const links = await db
          .select()
          .from(pointToPointLinks)
          .where(or(eq(pointToPointLinks.transmitter1Id, token.transmitterId), eq(pointToPointLinks.transmitter2Id, token.transmitterId)));
        const peerOf = (l: any) => (l.transmitter1Id === token.transmitterId ? l.transmitter2Id : l.transmitter1Id);
        const peerIds = links.map(peerOf);
        const peers = peerIds.length
          ? await db
              .select({ id: transmitters.id, username: transmitters.username, displayName: transmitters.displayName })
              .from(transmitters)
              .where(inArray(transmitters.id, peerIds))
          : [];
        const peerName = new Map<string, string>(peers.map((p: any) => [p.id, p.displayName || p.username]));
        for (const l of links) {
          channelInfo.set(l.id, { channelType: 'link', channelId: l.id, name: peerName.get(peerOf(l)) || 'Direct Link' });
        }
        const meshes = await db
          .select({ id: subspaceMeshes.id, name: subspaceMeshes.name })
          .from(subspaceMeshes)
          .innerJoin(subspaceMeshMembers, eq(subspaceMeshMembers.meshId, subspaceMeshes.id))
          .where(eq(subspaceMeshMembers.transmitterId, token.transmitterId));
        for (const m of meshes) channelInfo.set(m.id, { channelType: 'mesh', channelId: m.id, name: m.name });
        if (links.length) containerConds.push(inArray(transmissions.p2pLinkId, links.map((l: any) => l.id)));
        if (meshes.length) containerConds.push(inArray(transmissions.meshId, meshes.map((m: any) => m.id)));
      } else {
        const memberships = await db
          .select({ beaconId: beaconMembers.beaconId, name: beacons.name })
          .from(beaconMembers)
          .innerJoin(beacons, eq(beacons.id, beaconMembers.beaconId))
          .where(eq(beaconMembers.transmitterId, token.transmitterId));
        const beaconName = new Map<string, string>(memberships.map((m: any) => [m.beaconId, m.name]));
        let beaconIds: string[] = memberships.map((m: any) => m.beaconId);
        if (query.beaconId) {
          if (!beaconIds.includes(query.beaconId)) {
            return reply.status(403).send({ error: 'Transmitter is not a member of the requested Beacon' });
          }
          beaconIds = [query.beaconId];
        }
        const candidates = beaconIds.length
          ? await db
              .select()
              .from(relays)
              .where(and(inArray(relays.beaconId, beaconIds), query.relayId ? eq(relays.id, query.relayId) : undefined))
          : [];
        const allowed: string[] = [];
        for (const r of candidates) {
          if (r.type === 'comm_link' || r.type === 'stage') continue;
          const actorCtx = await resolveRelayActorContext(db, token.transmitterId, r);
          if (actorCtx && hasPermission(actorCtx.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
            allowed.push(r.id);
            channelInfo.set(r.id, { channelType: 'relay', channelId: r.id, name: r.name, beaconId: r.beaconId, beaconName: beaconName.get(r.beaconId) });
          }
        }
        if (allowed.length) {
          containerConds.push(inArray(transmissions.relayId, allowed));
          const threads = await db
            .select({ id: archivalThreads.id, relayId: archivalThreads.relayId, title: archivalThreads.title })
            .from(archivalThreads)
            .where(inArray(archivalThreads.relayId, allowed));
          for (const t of threads) {
            const parent = channelInfo.get(t.relayId)!;
            channelInfo.set(t.id, { channelType: 'thread', channelId: t.id, name: t.title, beaconId: parent.beaconId, beaconName: parent.beaconName, relayId: t.relayId });
          }
          if (threads.length) containerConds.push(inArray(transmissions.threadId, threads.map((t: any) => t.id)));
        }
      }

      if (containerConds.length === 0) return reply.send({ query: q, total: 0, count: 0, offset, transmissions: [] });

      const blocks = await db
        .select({ targetId: signalBlacklist.targetId })
        .from(signalBlacklist)
        .where(and(eq(signalBlacklist.transmitterId, token.transmitterId), eq(signalBlacklist.targetType, 'transmitter')));
      const blockedIds: string[] = blocks.map((b: any) => b.targetId);

      // Escape LIKE wildcards so `%` and `_` in the query match literally.
      const likePattern = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      const imageRe = '\\.(png|jpe?g|gif|webp|avif)$';
      const videoRe = '\\.(mp4|webm|mov)$';
      const where = and(
        or(...containerConds),
        q
          ? or(sql`to_tsvector('english', ${transmissions.content}) @@ plainto_tsquery('english', ${q})`, ilike(transmissions.content, likePattern))
          : undefined,
        from ? eq(transmissions.transmitterId, from) : undefined,
        query.mentions ? sql`${transmissions.mentions} @> ${JSON.stringify([query.mentions])}::jsonb` : undefined,
        query.pinned === 'true' ? isNotNull(transmissions.pinnedAt) : undefined,
        query.before ? lt(transmissions.createdAt, new Date(query.before)) : undefined,
        query.after ? gt(transmissions.createdAt, new Date(query.after)) : undefined,
        has === 'link' ? sql`${transmissions.content} ~* 'https?://'` : undefined,
        has === 'file' ? sql`jsonb_array_length(${transmissions.attachments}) > 0` : undefined,
        has === 'image'
          ? sql`exists (select 1 from jsonb_array_elements(${transmissions.attachments}) a where a->>'mimeType' like 'image/%' or a->>'filename' ~* ${imageRe})`
          : undefined,
        has === 'video'
          ? sql`exists (select 1 from jsonb_array_elements(${transmissions.attachments}) a where a->>'mimeType' like 'video/%' or a->>'filename' ~* ${videoRe})`
          : undefined,
        blockedIds.length ? notInArray(transmissions.transmitterId, blockedIds) : undefined,
        sql`${transmissions.type} not like 'system%'`
      );

      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(transmissions).where(where);
      const rows = await db
        .select()
        .from(transmissions)
        .where(where)
        .orderBy(query.sort === 'oldest' ? asc(transmissions.createdAt) : desc(transmissions.createdAt))
        .limit(limit)
        .offset(offset);

      const results = await Promise.all(
        rows.map(async (row: any) => {
          const channel = channelInfo.get(row.threadId || row.relayId || row.p2pLinkId || row.meshId) || null;
          const formatted = await formatTransmission(db, row, token.transmitterId, { beaconId: channel?.beaconId });
          // `transmission` keeps the original nested shape for older callers.
          return { ...formatted, channel, transmission: { content: row.content, attachments: row.attachments || [] } };
        })
      );

      return reply.send({ query: q, total, count: results.length, offset, transmissions: results });
    }
  );
};

interface SearchChannel {
  channelType: 'relay' | 'thread' | 'link' | 'mesh';
  channelId: string;
  name: string;
  beaconId?: string;
  beaconName?: string;
  /** Parent relay of a forum post. */
  relayId?: string;
}
