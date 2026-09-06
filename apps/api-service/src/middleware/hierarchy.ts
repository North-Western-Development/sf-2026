import { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, beacons, clearances, beaconMembers, transmitters } from '@subspace/database';
import { verifyToken, TokenPayload } from '@subspace/crypto';
import {
  computeMemberPermissions,
  getHighestRank,
  canModerate,
  hasPermission,
  PERMISSIONS,
} from '@subspace/constants';

const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';

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
  return verifyToken<TokenPayload>(token, JWT_SECRET);
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

  const effectivePermissions = computeMemberPermissions(activeClearances, isOwner);
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
