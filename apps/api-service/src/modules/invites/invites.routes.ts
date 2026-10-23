import { randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  or,
  count,
  beacons,
  beaconMembers,
  beaconBans,
  invites,
  transmitters,
  signalBlacklist,
  resolveBeaconAudience,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';
import { buildMember } from '../../lib/members.js';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ALLOWED_MAX_AGE = [0, 1800, 3600, 21600, 43200, 86400, 604800];

function generateInviteCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += BASE62[bytes[i] % BASE62.length];
  return out;
}

/**
 * Beacon invites (section 6): `/beacons/:id/invites`, `/invites/:code`.
 * Registered at the API root so both prefixes are addressable from one module.
 */
export const inviteRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/beacons/:id/invites
   */
  app.post(
    '/beacons/:id/invites',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            relayId: { type: 'string' },
            maxUses: { type: 'number', minimum: 0, maximum: 100 },
            maxAgeSeconds: { type: 'number' },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { id: beaconId } = request.params as { id: string };
      const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
      if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
      if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.CREATE_INVITES)) {
        return reply.status(403).send({ error: 'Transmitter lacks CREATE_INVITES clearance' });
      }

      const body = (request.body as any) || {};
      const maxUses = body.maxUses !== undefined ? Number(body.maxUses) : 0;
      const maxAgeSeconds = body.maxAgeSeconds !== undefined ? Number(body.maxAgeSeconds) : 604800;

      if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > 100) {
        return reply.status(400).send({ error: 'maxUses must be an integer between 0 and 100' });
      }
      if (!ALLOWED_MAX_AGE.includes(maxAgeSeconds)) {
        return reply.status(400).send({ error: 'maxAgeSeconds must be one of 0, 1800, 3600, 21600, 43200, 86400, 604800' });
      }

      let code = generateInviteCode();
      for (let attempts = 0; attempts < 5; attempts++) {
        const [existing] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
        if (!existing) break;
        code = generateInviteCode();
      }

      const expiresAt = maxAgeSeconds > 0 ? new Date(Date.now() + maxAgeSeconds * 1000) : null;

      const [invite] = await db
        .insert(invites)
        .values({
          code,
          beaconId,
          relayId: body.relayId || null,
          inviterId: token.transmitterId,
          maxUses,
          maxAgeSeconds,
          expiresAt,
        })
        .returning();

      return reply.status(201).send({ invite });
    }
  );

  /**
   * GET /api/v1/beacons/:id/invites
   */
  app.get('/beacons/:id/invites', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: beaconId } = request.params as { id: string };
    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });

    const canManage = hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_BEACON);
    const scope = canManage
      ? eq(invites.beaconId, beaconId)
      : and(eq(invites.beaconId, beaconId), eq(invites.inviterId, token.transmitterId));
    const rows = await db
      .select({
        invite: invites,
        inviter: {
          id: transmitters.id,
          username: transmitters.username,
          discriminator: transmitters.discriminator,
          displayName: transmitters.displayName,
          avatarUrl: transmitters.avatarUrl,
        },
      })
      .from(invites)
      .innerJoin(transmitters, eq(invites.inviterId, transmitters.id))
      .where(scope);

    // Expired and used-up invites can no longer be redeemed, so they are not listed.
    const now = Date.now();
    const live = rows.filter(
      ({ invite }: any) =>
        (!invite.expiresAt || new Date(invite.expiresAt).getTime() > now) && (!invite.maxUses || invite.uses < invite.maxUses)
    );
    return reply.send({ invites: live.map(({ invite, inviter }: any) => ({ ...invite, inviter })) });
  });

  /**
   * DELETE /api/v1/invites/:code
   */
  app.delete('/invites/:code', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { code } = request.params as { code: string };
    const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
    if (!invite) return reply.status(404).send({ error: 'Invite not found' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, invite.beaconId);
    const canManage = actorContext && hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_BEACON);

    if (invite.inviterId !== token.transmitterId && !canManage) {
      return reply.status(403).send({ error: 'Only the inviter or MANAGE_BEACON can revoke this invite' });
    }

    await db.delete(invites).where(eq(invites.code, code));
    return reply.send({ message: 'Invite revoked' });
  });

  /**
   * GET /api/v1/invites/:code (public, rate limited)
   */
  app.get(
    '/invites/:code',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { code } = request.params as { code: string };

      const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
      if (!invite) return reply.status(404).send({ error: 'Invite not found or expired' });
      if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
        return reply.status(404).send({ error: 'Invite not found or expired' });
      }
      if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
        return reply.status(404).send({ error: 'Invite not found or expired' });
      }

      const [beacon] = await db.select().from(beacons).where(eq(beacons.id, invite.beaconId)).limit(1);
      if (!beacon) return reply.status(404).send({ error: 'Invite not found or expired' });

      const [inviter] = await db
        .select()
        .from(transmitters)
        .where(eq(transmitters.id, invite.inviterId))
        .limit(1);

      const [{ value: memberCount }] = await db
        .select({ value: count() })
        .from(beaconMembers)
        .where(eq(beaconMembers.beaconId, beacon.id));

      return reply.send({
        code: invite.code,
        beacon: {
          id: beacon.id,
          name: beacon.name,
          iconUrl: beacon.iconUrl,
          bannerUrl: beacon.bannerUrl,
          description: beacon.description,
          memberCount: Number(memberCount),
          onlineCount: 0,
        },
        inviter: inviter
          ? { username: inviter.username, discriminator: inviter.discriminator, displayName: inviter.displayName }
          : null,
        expiresAt: invite.expiresAt,
      });
    }
  );

  /**
   * POST /api/v1/invites/:code/accept
   */
  app.post('/invites/:code/accept', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { code } = request.params as { code: string };
    const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
    if (!invite) return reply.status(404).send({ error: 'Invite not found or expired' });
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return reply.status(404).send({ error: 'Invite not found or expired' });
    }
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return reply.status(404).send({ error: 'Invite not found or expired' });
    }

    const [beacon] = await db.select().from(beacons).where(eq(beacons.id, invite.beaconId)).limit(1);
    if (!beacon) return reply.status(404).send({ error: 'Invite not found or expired' });

    const [ban] = await db
      .select()
      .from(beaconBans)
      .where(and(eq(beaconBans.beaconId, invite.beaconId), eq(beaconBans.transmitterId, token.transmitterId)))
      .limit(1);
    if (ban) return reply.status(403).send({ error: 'Transmitter is banned from this Beacon', code: 'BANNED' });

    const [blocked] = await db
      .select()
      .from(signalBlacklist)
      .where(
        and(
          eq(signalBlacklist.transmitterId, token.transmitterId),
          eq(signalBlacklist.targetId, invite.beaconId),
          eq(signalBlacklist.targetType, 'beacon')
        )
      )
      .limit(1);
    if (blocked) return reply.status(403).send({ error: 'Beacon is blocked', code: 'BLOCKED' });

    const [existingMember] = await db
      .select()
      .from(beaconMembers)
      .where(and(eq(beaconMembers.beaconId, invite.beaconId), eq(beaconMembers.transmitterId, token.transmitterId)))
      .limit(1);

    let requiresOnboarding = false;
    if (!existingMember) {
      await db.insert(beaconMembers).values({
        beaconId: invite.beaconId,
        transmitterId: token.transmitterId,
        hasCompletedOnboarding: false,
        clearanceIds: [],
      });
      requiresOnboarding = true;

      await db.update(invites).set({ uses: invite.uses + 1 }).where(eq(invites.code, code));

      await publishGatewayEvent(
        app,
        'MEMBER_ADD',
        { beaconId: invite.beaconId, member: await buildMember(db, (app as any).redis, invite.beaconId, token.transmitterId) },
        { beaconId: invite.beaconId }
      );
      await publishGatewayEvent(app, 'BEACON_CREATE', { beacon }, { transmitterIds: [token.transmitterId] });
      await publishSessionRefresh(app, [token.transmitterId]);
    }

    return reply.send({ beacon, requiresOnboarding });
  });
};
