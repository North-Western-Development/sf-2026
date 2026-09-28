import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, asc, desc, clearances, beaconMembers, beacons } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import {
  extractAuthToken,
  resolveBeaconActorContext,
  resolveBeaconTargetContext,
} from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { buildMember } from '../../lib/members.js';


const MAX_BITS = (1n << 64n) - 1n;

/** Parse a permission bitfield from a decimal string/number; null when malformed. */
function parseBits(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^\d{1,20}$/.test(value)) return null;
  try {
    const bits = BigInt(value);
    return bits >= 0n && bits <= MAX_BITS ? bits : null;
  } catch {
    return null;
  }
}

/** Non-owners may only toggle bits they hold themselves (ADMINISTRATOR holds all). */
function canChangeBits(actor: { isOwner: boolean; effectivePermissions: bigint }, before: bigint, after: bigint): boolean {
  if (actor.isOwner || hasPermission(actor.effectivePermissions, PERMISSIONS.ADMINISTRATOR)) return true;
  return ((before ^ after) & ~actor.effectivePermissions) === 0n;
}

export const clearanceRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * GET /api/v1/beacons/:id/clearances
   * List all clearances in a Beacon ordered by position descending
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    if (!(await resolveBeaconActorContext(db, token.transmitterId, beaconId))) {
      return reply.status(404).send({ error: 'Beacon not found' });
    }

    const allClearances = await db
      .select()
      .from(clearances)
      .where(eq(clearances.beaconId, beaconId))
      .orderBy(desc(clearances.position));

    return reply.send({
      clearances: allClearances.map((c: any) => ({
        ...c,
        permissions: c.permissions.toString(),
      })),
    });
  });

  /**
   * POST /api/v1/beacons/:id/clearances
   * Create a new clearance.
   * Invariants:
   * 1. Requires MANAGE_CLEARANCES (or owner).
   * 2. Position MUST be > 0 (only @everyone can be position 0; no role can be <= 0).
   * 3. Position MUST be strictly lower than the actor's highest rank (unless actor is owner).
   */
  app.post('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_CLEARANCES)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance' });
    }

    const body = request.body as any;
    const { name, color, position, permissions: permBits, allowDelegation } = body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.status(400).send({ error: 'Clearance name is required' });
    }

    const targetPosition = position === undefined ? 1 : Number(position);
    const requestedBits = permBits === undefined ? 0n : parseBits(permBits);
    if (requestedBits === null) {
      return reply.status(400).send({ error: 'permissions must be a non-negative 64-bit integer', code: 'INVALID_PERMISSIONS' });
    }
    if (!canChangeBits(actorContext, 0n, requestedBits)) {
      return reply.status(403).send({ error: 'Cannot grant permissions you do not hold', code: 'FORBIDDEN_PERMISSION_GRANT' });
    }
    if (isNaN(targetPosition) || targetPosition <= 0) {
      return reply.status(400).send({
        error: 'Clearance position must be a positive integer greater than 0 (cannot place below or at @everyone)',
        code: 'CANNOT_PLACE_BELOW_BASE_CLEARANCE',
      });
    }

    // Hierarchy check: Non-owner cannot create a clearance with position >= their own highest rank
    if (!actorContext.isOwner && targetPosition >= actorContext.highestRank) {
      return reply.status(403).send({
        error: 'Cannot create a clearance with position equal to or higher than own highest clearance',
        code: 'FORBIDDEN_HIERARCHY',
        actorRank: actorContext.highestRank,
        requestedPosition: targetPosition,
      });
    }

    const [newClearance] = await db
      .insert(clearances)
      .values({
        beaconId,
        name: name.trim(),
        color: color || '#99AAB5',
        position: targetPosition,
        permissions: requestedBits,
        allowDelegation: Boolean(allowDelegation),
      })
      .returning();

    await publishGatewayEvent(
      app,
      'CLEARANCE_CREATE',
      { beaconId, clearance: { ...newClearance, permissions: newClearance.permissions.toString() } },
      { beaconId }
    );

    return reply.status(201).send({
      message: 'Clearance created successfully',
      clearance: {
        ...newClearance,
        permissions: newClearance.permissions.toString(),
      },
    });
  });

  /**
   * PATCH /api/v1/beacons/:id/clearances/:clearanceId
   * Modify clearance attributes.
   * Invariants:
   * 1. If modifying @everyone (position === 0):
   *    - Permissions CAN be modified.
   *    - Position CANNOT be modified (fixed at 0).
   * 2. Non-owner cannot modify a clearance with position >= own highest rank.
   * 3. No clearance can have position changed to <= 0.
   */
  app.patch('/:clearanceId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId, clearanceId } = request.params as { id: string; clearanceId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_CLEARANCES)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance' });
    }

    const [targetClearance] = await db
      .select()
      .from(clearances)
      .where(and(eq(clearances.id, clearanceId), eq(clearances.beaconId, beaconId)))
      .limit(1);

    if (!targetClearance) {
      return reply.status(404).send({ error: 'Clearance not found' });
    }

    const isBaseRole = targetClearance.position === 0;

    // Hierarchy boundary: Actor cannot edit clearance equal or above their own rank
    // (Except @everyone which is position 0, below any non-owner admin rank)
    if (!actorContext.isOwner && !isBaseRole && targetClearance.position >= actorContext.highestRank) {
      return reply.status(403).send({
        error: 'Cannot modify a clearance with position equal to or higher than own rank',
        code: 'FORBIDDEN_HIERARCHY',
      });
    }

    const body = request.body as any;
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.color !== undefined) updates.color = body.color;
    if (body.permissions !== undefined) {
      const next = parseBits(body.permissions);
      if (next === null) {
        return reply.status(400).send({ error: 'permissions must be a non-negative 64-bit integer', code: 'INVALID_PERMISSIONS' });
      }
      if (!canChangeBits(actorContext, BigInt(targetClearance.permissions), next)) {
        return reply.status(403).send({ error: 'Cannot grant or revoke permissions you do not hold', code: 'FORBIDDEN_PERMISSION_GRANT' });
      }
      updates.permissions = next;
    }
    if (body.allowDelegation !== undefined) updates.allowDelegation = Boolean(body.allowDelegation);
    if (body.hoist !== undefined) updates.hoist = Boolean(body.hoist);

    if (body.position !== undefined) {
      const newPos = Number(body.position);
      if (isBaseRole) {
        if (newPos !== 0) {
          return reply.status(400).send({
            error: 'The base clearance (@everyone) position is strictly fixed at 0 and cannot be moved',
            code: 'CANNOT_REORDER_BASE_CLEARANCE',
          });
        }
      } else {
        if (newPos <= 0) {
          return reply.status(400).send({
            error: 'Custom clearances cannot have a position of 0 or less (cannot place below or at @everyone)',
            code: 'CANNOT_PLACE_BELOW_BASE_CLEARANCE',
          });
        }
        if (!actorContext.isOwner && newPos >= actorContext.highestRank) {
          return reply.status(403).send({
            error: 'Cannot move a clearance to equal or above own highest rank',
            code: 'FORBIDDEN_HIERARCHY',
          });
        }
        updates.position = newPos;
      }
    }

    const [updatedClearance] = await db
      .update(clearances)
      .set(updates)
      .where(eq(clearances.id, clearanceId))
      .returning();

    await publishGatewayEvent(
      app,
      'CLEARANCE_UPDATE',
      { beaconId, clearance: { ...updatedClearance, permissions: updatedClearance.permissions.toString() } },
      { beaconId }
    );

    return reply.send({
      message: 'Clearance updated successfully',
      clearance: {
        ...updatedClearance,
        permissions: updatedClearance.permissions.toString(),
      },
    });
  });

  /**
   * DELETE /api/v1/beacons/:id/clearances/:clearanceId
   * Invariants:
   * 1. @everyone (position 0) CANNOT be deleted.
   * 2. Cannot delete a clearance with position >= actor's highest rank (unless owner).
   */
  app.delete('/:clearanceId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId, clearanceId } = request.params as { id: string; clearanceId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_CLEARANCES)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance' });
    }

    const [targetClearance] = await db
      .select()
      .from(clearances)
      .where(and(eq(clearances.id, clearanceId), eq(clearances.beaconId, beaconId)))
      .limit(1);

    if (!targetClearance) {
      return reply.status(404).send({ error: 'Clearance not found' });
    }

    if (targetClearance.position === 0) {
      return reply.status(400).send({
        error: 'The base clearance (@everyone) cannot be deleted',
        code: 'CANNOT_DELETE_BASE_CLEARANCE',
      });
    }

    if (!actorContext.isOwner && targetClearance.position >= actorContext.highestRank) {
      return reply.status(403).send({
        error: 'Cannot delete a clearance with position equal to or higher than own rank',
        code: 'FORBIDDEN_HIERARCHY',
      });
    }

    // Remove clearance from any members who hold it
    const allMembers = await db
      .select()
      .from(beaconMembers)
      .where(eq(beaconMembers.beaconId, beaconId));

    for (const m of allMembers) {
      const ids = (m.clearanceIds as string[]) || [];
      if (ids.includes(clearanceId)) {
        await db
          .update(beaconMembers)
          .set({ clearanceIds: ids.filter((id) => id !== clearanceId) })
          .where(
            and(
              eq(beaconMembers.beaconId, beaconId),
              eq(beaconMembers.transmitterId, m.transmitterId)
            )
          );
      }
    }

    await db.delete(clearances).where(eq(clearances.id, clearanceId));

    await publishGatewayEvent(app, 'CLEARANCE_DELETE', { beaconId, clearanceId }, { beaconId });

    return reply.send({ message: 'Clearance decommissioned successfully' });
  });

  /**
   * POST /api/v1/beacons/:id/members/:targetId/clearances
   * Assign or revoke a clearance to a member.
   * Invariants:
   * 1. Requires MANAGE_CLEARANCES.
   * 2. Cannot assign/revoke clearance with rank >= actor's highest rank (unless owner).
   * 3. Cannot assign/revoke to a member who has equal or higher rank than actor (unless owner).
   */
  app.post('/members/:targetId/assign', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: beaconId, targetId } = request.params as { id: string; targetId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const actorContext = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_CLEARANCES)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_CLEARANCES clearance' });
    }

    const body = request.body as any;
    const { clearanceId, action } = body || {}; // action: 'add' | 'remove'

    if (!clearanceId || (action !== 'add' && action !== 'remove')) {
      return reply.status(400).send({ error: 'clearanceId and action (add | remove) required' });
    }

    const [targetClearance] = await db
      .select()
      .from(clearances)
      .where(and(eq(clearances.id, clearanceId), eq(clearances.beaconId, beaconId)))
      .limit(1);

    if (!targetClearance) {
      return reply.status(404).send({ error: 'Clearance not found in Beacon' });
    }

    // Role rank boundary check
    if (!actorContext.isOwner && targetClearance.position >= actorContext.highestRank) {
      return reply.status(403).send({
        error: 'Cannot assign or remove a clearance equal to or higher than own rank',
        code: 'FORBIDDEN_HIERARCHY',
      });
    }

    // Target member boundary check
    const targetContext = await resolveBeaconTargetContext(db, targetId, beaconId);
    if (!targetContext) {
      return reply.status(404).send({ error: 'Target member not found in Beacon' });
    }

    if (!actorContext.isOwner && targetContext.highestRank >= actorContext.highestRank) {
      return reply.status(403).send({
        error: 'Cannot modify clearances for a member with equal or higher rank',
        code: 'FORBIDDEN_HIERARCHY',
      });
    }

    const currentIds = (targetContext.member?.clearanceIds as string[]) || [];
    let updatedIds: string[];

    if (action === 'add') {
      if (!currentIds.includes(clearanceId)) {
        updatedIds = [...currentIds, clearanceId];
      } else {
        updatedIds = currentIds;
      }
    } else {
      updatedIds = currentIds.filter((id) => id !== clearanceId);
    }

    await db
      .update(beaconMembers)
      .set({ clearanceIds: updatedIds })
      .where(
        and(
          eq(beaconMembers.beaconId, beaconId),
          eq(beaconMembers.transmitterId, targetId)
        )
      );

    await publishGatewayEvent(
      app,
      'MEMBER_UPDATE',
      { beaconId, member: await buildMember(db, (app as any).redis, beaconId, targetId) },
      { beaconId }
    );

    return reply.send({
      message: `Clearance ${action === 'add' ? 'assigned to' : 'revoked from'} member`,
      clearanceIds: updatedIds,
    });
  });
};
