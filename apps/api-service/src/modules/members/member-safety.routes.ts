import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, gte, inArray, beaconMembers, beacons, relays, transmissions, transmitters, resolveBeaconAudience } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';

/** Any of these lets a member see the Members page. */
const MODERATION = [PERMISSIONS.KICK_MEMBERS, PERMISSIONS.BAN_MEMBERS, PERMISSIONS.MANAGE_CLEARANCES, PERMISSIONS.MANAGE_NICKNAMES];
const NEW_ACCOUNT_DAYS = 7;
const DAY = 86_400_000;

/**
 * The beacon's Members page (Discord's Member Safety): who joined when, how, with which
 * invite, and safety signals; plus pruning inactive members.
 *   GET  /api/v1/beacons/:id/member-details
 *   GET  /api/v1/beacons/:id/prune?days=   (how many would be removed)
 *   POST /api/v1/beacons/:id/prune         { days }
 */
export const memberSafetyRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  app.get('/:id/member-details', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { id: beaconId } = request.params as { id: string };
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    if (!MODERATION.some((p) => hasPermission(actor.effectivePermissions, p))) {
      return reply.status(403).send({ error: 'Viewing member details needs a moderation permission' });
    }

    const rows = await db
      .select({
        transmitterId: beaconMembers.transmitterId,
        joinedAt: beaconMembers.joinedAt,
        joinMethod: beaconMembers.joinMethod,
        joinInviteCode: beaconMembers.joinInviteCode,
        invitedBy: beaconMembers.invitedBy,
        accountCreatedAt: transmitters.createdAt,
        isEmailVerified: transmitters.isEmailVerified,
      })
      .from(beaconMembers)
      .innerJoin(transmitters, eq(beaconMembers.transmitterId, transmitters.id))
      .where(eq(beaconMembers.beaconId, beaconId));

    const inviterIds = [...new Set(rows.map((r: any) => r.invitedBy).filter(Boolean))] as string[];
    const inviters = inviterIds.length
      ? await db.select({ id: transmitters.id, username: transmitters.username, discriminator: transmitters.discriminator, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl }).from(transmitters).where(inArray(transmitters.id, inviterIds))
      : [];
    const inviterById = new Map(inviters.map((u: any) => [u.id, u]));
    const now = Date.now();

    return reply.send({
      members: rows.map((r: any) => {
        const signals: string[] = [];
        if (now - new Date(r.accountCreatedAt).getTime() < NEW_ACCOUNT_DAYS * DAY) signals.push('new_account');
        if (!r.isEmailVerified) signals.push('unverified_email');
        return {
          transmitterId: r.transmitterId,
          joinedAt: r.joinedAt,
          accountCreatedAt: r.accountCreatedAt,
          joinMethod: r.joinMethod ?? 'unknown',
          inviteCode: r.joinInviteCode,
          inviter: r.invitedBy ? inviterById.get(r.invitedBy) ?? null : null,
          signals,
        };
      }),
    });
  });

  /** Members with no clearances who joined more than `days` ago and have not transmitted here since. */
  async function pruneCandidates(beaconId: string, ownerId: string, days: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - days * DAY);
    const members = await db
      .select({ transmitterId: beaconMembers.transmitterId, clearanceIds: beaconMembers.clearanceIds, joinedAt: beaconMembers.joinedAt })
      .from(beaconMembers)
      .where(eq(beaconMembers.beaconId, beaconId));
    const quiet = members.filter((m: any) => m.transmitterId !== ownerId && !(m.clearanceIds as string[]).length && new Date(m.joinedAt) < cutoff);
    if (!quiet.length) return [];
    const active = await db
      .selectDistinct({ transmitterId: transmissions.transmitterId })
      .from(transmissions)
      .innerJoin(relays, eq(transmissions.relayId, relays.id))
      .where(and(eq(relays.beaconId, beaconId), gte(transmissions.createdAt, cutoff), inArray(transmissions.transmitterId, quiet.map((m: any) => m.transmitterId))));
    const activeIds = new Set(active.map((a: any) => a.transmitterId));
    return quiet.map((m: any) => m.transmitterId).filter((id: string) => !activeIds.has(id));
  }

  const parseDays = (v: unknown) => {
    const n = Number(v);
    return [1, 7, 30].includes(n) ? n : null;
  };

  async function pruneContext(request: any, reply: any) {
    const token = extractAuthToken(request);
    if (!token) return void reply.status(401).send({ error: 'Authentication required' });
    if (!db) return void reply.status(503).send({ error: 'Database service unavailable' });
    const { id: beaconId } = request.params as { id: string };
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return void reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    if (!hasPermission(actor.effectivePermissions, PERMISSIONS.KICK_MEMBERS)) return void reply.status(403).send({ error: 'Pruning needs KICK_MEMBERS' });
    const [beacon] = await db.select({ ownerId: beacons.ownerId }).from(beacons).where(eq(beacons.id, beaconId)).limit(1);
    return { beaconId, ownerId: beacon.ownerId as string };
  }

  app.get('/:id/prune', async (request, reply) => {
    const ctx = await pruneContext(request, reply);
    if (!ctx) return;
    const days = parseDays((request.query as any)?.days);
    if (!days) return reply.status(400).send({ error: 'days must be 1, 7 or 30' });
    return reply.send({ days, count: (await pruneCandidates(ctx.beaconId, ctx.ownerId, days)).length });
  });

  app.post('/:id/prune', async (request, reply) => {
    const ctx = await pruneContext(request, reply);
    if (!ctx) return;
    const days = parseDays((request.body as any)?.days);
    if (!days) return reply.status(400).send({ error: 'days must be 1, 7 or 30' });
    const ids = await pruneCandidates(ctx.beaconId, ctx.ownerId, days);
    if (ids.length) {
      await db.delete(beaconMembers).where(and(eq(beaconMembers.beaconId, ctx.beaconId), inArray(beaconMembers.transmitterId, ids)));
      const audience = await resolveBeaconAudience(db, ctx.beaconId);
      for (const id of ids) {
        await publishGatewayEvent(app, 'MEMBER_REMOVE', { beaconId: ctx.beaconId, transmitterId: id }, { transmitterIds: [id, ...audience] });
      }
      await publishSessionRefresh(app, [...ids, ...audience]);
    }
    return reply.send({ pruned: ids.length });
  });
};

