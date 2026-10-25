import { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, beacons, clearances, beaconMembers, transmitters, computeRelayPermissions } from '@subspace/database';
import { verifyAccessToken, TokenPayload, getJwtSecret } from '@subspace/crypto';
import {
  computeMemberPermissions,
  restrictPermissions,
  meetsVerification,
  getHighestRank,
  canModerate,
  hasPermission,
  PERMISSIONS,
} from '@subspace/constants';

const JWT_SECRET = getJwtSecret();

export interface ClearanceContext {
  transmitterId: string;
  beaconId: string;
  isOwner: boolean;
  member: typeof beaconMembers.$inferSelect;
  clearances: Array<typeof clearances.$inferSelect>;
  effectivePermissions: bigint;
  highestRank: number;
}

export function extractAuthToken(request: FastifyRequest): TokenPayload | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  return verifyAccessToken(token, JWT_SECRET);
}

/**
 * Resolves the actor's clearance context within a specific beacon
 */
export async function resolveBeaconActorContext(
  db: any,
  transmitterId: string,
  beaconId: string
): Promise<ClearanceContext | null> {
  // Check beacon exists
  const [beacon] = await db
    .select()
    .from(beacons)
    .where(eq(beacons.id, beaconId))
    .limit(1);

  if (!beacon) {
    return null;
  }

  const isOwner = beacon.ownerId === transmitterId;

  // Retrieve member record
  const [member] = await db
    .select()
    .from(beaconMembers)
    .where(
      and(
        eq(beaconMembers.beaconId, beaconId),
        eq(beaconMembers.transmitterId, transmitterId)
      )
    )
    .limit(1);

  if (!member && !isOwner) {
    return null;
  }

  // Fetch all clearances in beacon
  const allBeaconClearances: Array<typeof clearances.$inferSelect> = await db
    .select()
    .from(clearances)
    .where(eq(clearances.beaconId, beaconId));

  // Find @everyone (position 0)
  const everyoneClearance = allBeaconClearances.find((c) => c.position === 0);

  // Active clearances for member (assigned + @everyone)
  const assignedIds = new Set(member?.clearanceIds || []);
  const activeClearances = allBeaconClearances.filter(
    (c) => assignedIds.has(c.id) || c.position === 0
  );

  const [account] = await db
    .select({ quarantinedAt: transmitters.quarantinedAt, isEmailVerified: transmitters.isEmailVerified, createdAt: transmitters.createdAt, is2faEnabled: transmitters.is2faEnabled })
    .from(transmitters)
    .where(eq(transmitters.id, transmitterId))
    .limit(1);
  // A timeout, a staff quarantine, or not yet meeting the verification level takes away posting, reacting and voice.
  const unverified = !!member && !!account && !meetsVerification(beacon.verificationLevel, account, { joinedAt: member.joinedAt, hasClearance: assignedIds.size > 0 });
  const effectivePermissions = restrictPermissions(computeMemberPermissions(activeClearances, isOwner), {
    timeoutUntil: member?.timeoutUntil,
    quarantined: !!account?.quarantinedAt,
    unverified,
  });
  const highestRank = getHighestRank(activeClearances, isOwner);

  return {
    transmitterId,
    beaconId,
    isOwner,
    member: member || {
      beaconId,
      transmitterId,
      nickname: null,
      hasCompletedOnboarding: true,
      clearanceIds: [],
      joinedAt: beacon.createdAt,
    },
    clearances: activeClearances,
    effectivePermissions,
    highestRank,
  };
}

/**
 * Actor context for a relay-scoped action: membership as for the beacon, but
 * `effectivePermissions` include the relay's permission overwrites (private relays,
 * per-clearance denies). Use this for every check that concerns a specific relay.
 */
export async function resolveRelayActorContext(
  db: any,
  transmitterId: string,
  relay: { id: string; beaconId: string }
): Promise<ClearanceContext | null> {
  const ctx = await resolveBeaconActorContext(db, transmitterId, relay.beaconId);
  if (!ctx) return null;
  return { ...ctx, effectivePermissions: await computeRelayPermissions(db, transmitterId, relay.id) };
}

/**
 * Resolves a target member's clearance context
 */
export async function resolveBeaconTargetContext(
  db: any,
  targetId: string,
  beaconId: string
): Promise<{
  isOwner: boolean;
  member: typeof beaconMembers.$inferSelect | null;
  clearances: Array<typeof clearances.$inferSelect>;
  highestRank: number;
} | null> {
  const [beacon] = await db
    .select()
    .from(beacons)
    .where(eq(beacons.id, beaconId))
    .limit(1);

  if (!beacon) return null;

  const isOwner = beacon.ownerId === targetId;

  const [member] = await db
    .select()
    .from(beaconMembers)
    .where(
      and(
        eq(beaconMembers.beaconId, beaconId),
        eq(beaconMembers.transmitterId, targetId)
      )
    )
    .limit(1);

  if (!member && !isOwner) return null;

  const allBeaconClearances: Array<typeof clearances.$inferSelect> = await db
    .select()
    .from(clearances)
    .where(eq(clearances.beaconId, beaconId));

  const assignedIds = new Set(member?.clearanceIds || []);
  const activeClearances = allBeaconClearances.filter(
    (c) => assignedIds.has(c.id) || c.position === 0
  );

  const highestRank = getHighestRank(activeClearances, isOwner);

  return {
    isOwner,
    member: member || null,
    clearances: activeClearances,
    highestRank,
  };
}

/**
 * Middleware asserting that the requester has a specific permission bit (or Administrator / Owner)
 */
export function requirePermission(permission: bigint) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const db = (request.server as any).db;
    const { id: beaconId } = request.params as { id: string };

    const tokenPayload = extractAuthToken(request);
    if (!tokenPayload) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const context = await resolveBeaconActorContext(db, tokenPayload.transmitterId, beaconId);
    if (!context) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(context.effectivePermissions, permission)) {
      return reply.status(403).send({
        error: 'Insufficient clearances',
        requiredPermission: permission.toString(),
      });
    }

    (request as any).clearanceContext = context;
  };
}

/**
 * Helper checking strict hierarchy moderation authority
 */
export async function assertCanModerateTarget(
  db: any,
  actorContext: ClearanceContext,
  targetId: string,
  reply: FastifyReply
): Promise<boolean> {
  const targetContext = await resolveBeaconTargetContext(db, targetId, actorContext.beaconId);
  if (!targetContext) {
    reply.status(404).send({ error: 'Target member not found in Beacon' });
    return false;
  }

  if (targetContext.isOwner) {
    reply.status(403).send({ error: 'Cannot moderate the Beacon owner', code: 'FORBIDDEN_HIERARCHY' });
    return false;
  }

  const allowed = canModerate(
    actorContext.highestRank,
    targetContext.highestRank,
    actorContext.isOwner,
    targetContext.isOwner
  );

  if (!allowed) {
    reply.status(403).send({
      error: 'Cannot moderate member with equal or higher clearance position',
      code: 'FORBIDDEN_HIERARCHY',
      actorRank: actorContext.highestRank,
      targetRank: targetContext.highestRank,
    });
    return false;
  }

  return true;
}
