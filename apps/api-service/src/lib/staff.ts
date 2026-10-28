import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, transmitters, staffAuditLog, staffRoleOf, rolePermissions, rolePosition, type StaffRoleRow } from '@subspace/database';
import { STAFF_PERMISSIONS, type StaffPermission } from '@subspace/constants';
import { extractAuthToken } from '../middleware/hierarchy.js';

export interface StaffActor {
  token: NonNullable<ReturnType<typeof extractAuthToken>>;
  staffMember: typeof transmitters.$inferSelect;
  role: StaffRoleRow;
  permissions: number;
  position: number;
}

/**
 * The signed-in staff member and what their rank allows, read from the database (never the
 * token, so a changed rank applies at once). Answers 401/403 and returns null otherwise.
 * Without a permission, any staff rank will do.
 */
export async function requireStaff(db: any, request: FastifyRequest, reply: FastifyReply, permission?: StaffPermission): Promise<StaffActor | null> {
  const token = extractAuthToken(request);
  if (!token) {
    reply.status(401).send({ error: 'Authentication required' });
    return null;
  }
  if (!db) {
    reply.status(503).send({ error: 'Database service unavailable' });
    return null;
  }
  const [staffMember] = await db.select().from(transmitters).where(eq(transmitters.id, token.transmitterId)).limit(1);
  const role = staffMember ? await staffRoleOf(db, staffMember) : null;
  const permissions = rolePermissions(role);
  if (!staffMember || !role || (permission && !(permissions & STAFF_PERMISSIONS[permission]))) {
    reply.status(403).send({
      error: 'Your staff rank does not allow this',
      code: 'INSUFFICIENT_STAFF_RANK',
      ...(permission ? { requiredPermission: permission } : {}),
    });
    return null;
  }
  return { token, staffMember, role, permissions, position: rolePosition(role) };
}

/** Where an account stands among staff: 0 when it is not staff. */
export async function positionOf(db: any, user: { staffRank?: number | null; staffRoleId?: string | null }) {
  return rolePosition(await staffRoleOf(db, user));
}

/** Refuses (403) acting on an account whose rank is not below the actor's. */
export async function outranks(db: any, actor: StaffActor, target: { id: string; staffRank?: number | null; staffRoleId?: string | null }, reply: FastifyReply) {
  if ((await positionOf(db, target)) < actor.position) return true;
  reply.status(403).send({ error: 'You can only act on accounts below your own staff rank', code: 'FORBIDDEN_STAFF_HIERARCHY' });
  return false;
}

/** Writes one line to the staff log. A failure here never undoes the action itself. */
export async function staffAudit(
  db: any,
  actor: StaffActor,
  entry: { action: string; summary: string; targetType?: string; targetId?: string | null; details?: Record<string, unknown> }
) {
  await db
    .insert(staffAuditLog)
    .values({ actorId: actor.staffMember.id, action: entry.action, summary: entry.summary, targetType: entry.targetType ?? null, targetId: entry.targetId ?? null, details: entry.details ?? null })
    .catch(() => {});
}

/** "Name (username#0001)" for log lines. */
export const who = (u: { displayName?: string | null; username: string; discriminator?: string | null }) =>
  `${u.displayName || u.username} (${u.username}${u.discriminator ? `#${u.discriminator}` : ''})`;
