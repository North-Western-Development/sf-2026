import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  or,
  desc,
  lt,
  gt,
  isNull,
  inArray,
  sql,
  transmitters,
  staffRoles,
  staffAuditLog,
  commendations,
  transmitterCommendations,
  newSnowflake,
  assignStaffRole,
  staffRoleOf,
  rolePermissions,
  rolePosition,
  type StaffRoleRow,
} from '@subspace/database';
import { ALL_STAFF_PERMISSIONS, BADGE_CRITERIA, type BadgeCriteria } from '@subspace/constants';
import { requireStaff, outranks, staffAudit, who, type StaffActor } from '../../lib/staff.js';
import { validateMediaUrl } from '../../lib/media.js';

/**
 * Command Console: staff ranks and who holds them, custom badges, and the staff log.
 *
 *   GET    /me                              the caller's rank and permissions
 *   GET    /staff-roles                     every rank, highest first, with member counts
 *   POST   /staff-roles                     create a rank (lands at the bottom)
 *   PATCH  /staff-roles/:id                 rename, recolor, change permissions or badge
 *   PUT    /staff-roles/order { ids }       reorder the ranks below the caller's
 *   DELETE /staff-roles/:id                 delete a rank; its holders leave staff
 *   GET    /staff                           every staff member
 *   PATCH  /transmitters/:id/staff-role     { roleId | null } give or take a rank
 *   GET    /badges, POST /badges, PATCH/DELETE /badges/:id
 *   GET    /badges/:id/holders, POST /badges/:id/holders, DELETE /badges/:id/holders/:transmitterId
 *   GET    /transmitters/:id/badges         the hand-awarded badges, held or not
 *   GET    /audit-log?before=&limit=        the staff log, newest first
 *
 * Staff act only below their own rank: they give and edit ranks lower than theirs, and never
 * grant a permission they do not have. Root (the built-in top rank) can do everything.
 */

const ID = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } as const;
const idParams = { type: 'object', properties: { id: ID } } as const;
const roleBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 32 },
    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    permissions: { type: 'integer', minimum: 0 },
    badgeId: { anyOf: [ID, { type: 'null' }] },
  },
} as const;
const badgeBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 32 },
    description: { type: 'string', minLength: 1, maxLength: 200 },
    iconUrl: { type: 'string', maxLength: 500 },
    criteriaType: { type: 'string', enum: [...BADGE_CRITERIA] },
    threshold: { type: 'integer', minimum: 0, maximum: 10_000_000 },
  },
} as const;
const RULES: BadgeCriteria[] = ['account_age', 'transmissions_sent', 'voice_minutes'];
const MAX_ROLES = 50;

export const staffRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  const serializeRole = (r: StaffRoleRow, members = 0) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    position: r.position,
    permissions: rolePermissions(r),
    isRoot: r.isRoot,
    builtIn: r.legacyRank !== null,
    legacyRank: r.legacyRank,
    badgeId: r.badgeId,
    members,
  });
  const serializeBadge = (b: any, holders = 0) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    iconUrl: b.iconUrl,
    criteriaType: b.criteriaType,
    threshold: b.threshold,
    holders,
    createdAt: b.createdAt,
  });

  /** A rank the actor may hand out, edit or delete: below their own (Root: any). */
  const canManage = (actor: StaffActor, role: StaffRoleRow) => actor.role.isRoot || rolePosition(role) < actor.position;

  /** Holders of a rank: assigned to it, or (built-in ranks) carrying its staff_rank number without one. */
  const holdersOf = (role: StaffRoleRow) =>
    role.legacyRank !== null
      ? or(eq(transmitters.staffRoleId, role.id), and(isNull(transmitters.staffRoleId), eq(transmitters.staffRank, role.legacyRank)))
      : eq(transmitters.staffRoleId, role.id);

  async function allRoles(): Promise<StaffRoleRow[]> {
    return db.select().from(staffRoles).orderBy(desc(staffRoles.position), staffRoles.createdAt);
  }

  /** Spreads the given ranks (highest first) over the positions they already occupy. */
  async function respace(ordered: StaffRoleRow[], slots: number[]) {
    const sorted = [...slots].sort((a, b) => b - a);
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].position !== sorted[i]) await db.update(staffRoles).set({ position: sorted[i], updatedAt: new Date() }).where(eq(staffRoles.id, ordered[i].id));
    }
  }

  // ---- The caller ----------------------------------------------------------

  app.get('/me', async (request, reply) => {
    const auth = await requireStaff(db, request, reply);
    if (!auth) return;
    return reply.send({ role: serializeRole(auth.role), permissions: auth.permissions, position: auth.position });
  });

  // ---- Staff ranks ---------------------------------------------------------

  app.get('/staff-roles', async (request, reply) => {
    const auth = await requireStaff(db, request, reply);
    if (!auth) return;
    const roles = await allRoles();
    const counts = await Promise.all(roles.map(async (r) => Number((await db.select({ n: sql<number>`count(*)::int` }).from(transmitters).where(and(holdersOf(r), isNull(transmitters.deletedAt))))[0]?.n ?? 0)));
    return reply.send({ roles: roles.map((r, i) => serializeRole(r, counts[i])) });
  });

  app.post('/staff-roles', { schema: { body: { ...roleBody, required: ['name'] } } }, async (request, reply) => {
    const auth = await requireStaff(db, request, reply, 'MANAGE_STAFF');
    if (!auth) return;
    const b = request.body as { name: string; color?: string; permissions?: number; badgeId?: string | null };
    const permissions = (b.permissions ?? 0) & ALL_STAFF_PERMISSIONS;
    if (!auth.role.isRoot && permissions & ~auth.permissions) {
      return reply.status(403).send({ error: 'You cannot grant permissions you do not have', code: 'PERMISSION_ESCALATION' });
    }
    if (b.badgeId && !(await rankBadge(b.badgeId))) return reply.status(400).send({ error: 'Pick a badge made for staff ranks', code: 'INVALID_BADGE' });
    const roles = await allRoles();
    if (roles.length >= MAX_ROLES) return reply.status(400).send({ error: `An instance can have up to ${MAX_ROLES} staff ranks`, code: 'TOO_MANY_ROLES' });
    // New ranks start at the bottom; the rest keep their order.
    const lowest = Math.min(...roles.filter((r) => !r.isRoot).map((r) => r.position), 100);
    let position = lowest - 10;
    if (position < 1) {
      const nonRoot = roles.filter((r) => !r.isRoot);
      await respace(nonRoot, nonRoot.map((_, i) => (nonRoot.length + 1 - i) * 10));
      position = 10;
    }
    const [role] = await db.insert(staffRoles).values({ name: b.name.trim(), color: b.color ?? '#3B8EF2', permissions, position, badgeId: b.badgeId ?? null }).returning();
    await staffAudit(db, auth, { action: 'staff_role.create', targetType: 'staff_role', targetId: role.id, summary: `Created the ${role.name} rank`, details: { permissions } });
    return reply.status(201).send({ role: serializeRole(role) });
  });

  /** A badge a rank may wear: a custom badge awarded by staff rank. */
  async function rankBadge(id: string) {
    const [badge] = await db.select().from(commendations).where(and(eq(commendations.id, id), eq(commendations.isCustom, true), eq(commendations.criteriaType, 'staff_role'))).limit(1);
    return badge ?? null;
  }

  app.patch('/staff-roles/:id', { schema: { params: idParams, body: roleBody } }, async (request, reply) => {
    const auth = await requireStaff(db, request, reply, 'MANAGE_STAFF');
    if (!auth) return;
    const [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, (request.params as any).id)).limit(1);
    if (!role) return reply.status(404).send({ error: 'Staff rank not found', code: 'STAFF_ROLE_NOT_FOUND' });
    if (!canManage(auth, role)) return reply.status(403).send({ error: 'You can only edit ranks below your own', code: 'FORBIDDEN_STAFF_HIERARCHY' });
    const b = request.body as { name?: string; color?: string; permissions?: number; badgeId?: string | null };
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name.trim();
    if (b.color !== undefined) set.color = b.color;
    if (b.permissions !== undefined && !role.isRoot) {
      const permissions = b.permissions & ALL_STAFF_PERMISSIONS;
      if (!auth.role.isRoot && permissions & ~auth.permissions) {
        return reply.status(403).send({ error: 'You cannot grant permissions you do not have', code: 'PERMISSION_ESCALATION' });
      }
      set.permissions = permissions;
    }
    if (b.badgeId !== undefined) {
      if (b.badgeId && !(await rankBadge(b.badgeId))) return reply.status(400).send({ error: 'Pick a badge made for staff ranks', code: 'INVALID_BADGE' });
      set.badgeId = b.badgeId;
    }
    const [updated] = await db.update(staffRoles).set(set).where(eq(staffRoles.id, role.id)).returning();
    await staffAudit(db, auth, { action: 'staff_role.update', targetType: 'staff_role', targetId: role.id, summary: `Changed the ${updated.name} rank`, details: b });
    return reply.send({ role: serializeRole(updated) });
  });

  app.put(
    '/staff-roles/order',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['ids'], properties: { ids: { type: 'array', items: ID, maxItems: MAX_ROLES } } } } },
    async (request, reply) => {
      const auth = await requireStaff(db, request, reply, 'MANAGE_STAFF');
      if (!auth) return;
      // The caller orders exactly the ranks they manage (Root's own rank always stays on top).
      const movable = (await allRoles()).filter((r) => !r.isRoot && canManage(auth, r) && r.id !== auth.role.id);
      const { ids } = request.body as { ids: string[] };
      const byId = new Map(movable.map((r) => [r.id, r]));
      if (ids.length !== movable.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
        return reply.status(400).send({ error: 'List every rank below yours exactly once', code: 'INVALID_ORDER' });
      }
      await respace(
        ids.map((id) => byId.get(id)!),
        movable.map((r) => r.position)
      );
      await staffAudit(db, auth, { action: 'staff_role.reorder', summary: 'Reordered the staff ranks', details: { order: ids.map((id) => byId.get(id)!.name) } });
      return reply.send({ roles: (await allRoles()).map((r) => serializeRole(r)) });
    }
  );

  app.delete('/staff-roles/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await requireStaff(db, request, reply, 'MANAGE_STAFF');
    if (!auth) return;
    const [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, (request.params as any).id)).limit(1);
    if (!role) return reply.status(404).send({ error: 'Staff rank not found', code: 'STAFF_ROLE_NOT_FOUND' });
    if (role.isRoot) return reply.status(400).send({ error: 'The Root rank cannot be deleted', code: 'ROOT_ROLE' });
    if (!canManage(auth, role)) return reply.status(403).send({ error: 'You can only delete ranks below your own', code: 'FORBIDDEN_STAFF_HIERARCHY' });
    // Its holders leave staff (they can be given another rank afterwards).
    const left = await db.update(transmitters).set({ staffRoleId: null, staffRank: 0, updatedAt: new Date() }).where(holdersOf(role)).returning({ id: transmitters.id });
    await db.delete(staffRoles).where(eq(staffRoles.id, role.id));
    await staffAudit(db, auth, { action: 'staff_role.delete', targetType: 'staff_role', targetId: role.id, summary: `Deleted the ${role.name} rank`, details: { membersRemoved: left.length } });
    return reply.send({ deleted: true, membersRemoved: left.length });
  });

  // ---- Staff members -------------------------------------------------------

  app.get('/staff', async (request, reply) => {
    const auth = await requireStaff(db, request, reply);
    if (!auth) return;
    const rows = await db
      .select({
        id: transmitters.id,
        username: transmitters.username,
        discriminator: transmitters.discriminator,
        displayName: transmitters.displayName,
        avatarUrl: transmitters.avatarUrl,
        staffRank: transmitters.staffRank,
        staffRoleId: transmitters.staffRoleId,
        createdAt: transmitters.createdAt,
      })
      .from(transmitters)
      .where(and(isNull(transmitters.deletedAt), or(gt(transmitters.staffRank, 0), sql`${transmitters.staffRoleId} is not null`)));
    const roles = await allRoles();
    const resolve = (u: any) => roles.find((r) => r.id === u.staffRoleId) ?? roles.find((r) => !u.staffRoleId && r.legacyRank === Math.min(u.staffRank, 3)) ?? null;
    const staff = rows
      .map((u: any) => ({ ...u, role: resolve(u) }))
      .filter((u: any) => u.role)
      .sort((a: any, b: any) => b.role.position - a.role.position || String(a.username).localeCompare(b.username))
      .map((u: any) => ({ ...u, role: serializeRole(u.role) }));
    return reply.send({ staff });
  });

  app.patch(
    '/transmitters/:id/staff-role',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['roleId'], properties: { roleId: { anyOf: [ID, { type: 'null' }] } } } } },
    async (request, reply) => {
      const auth = await requireStaff(db, request, reply, 'MANAGE_STAFF');
      if (!auth) return;
      const targetId = (request.params as any).id as string;
      const { roleId } = request.body as { roleId: string | null };
      if (targetId === auth.staffMember.id) return reply.status(400).send({ error: 'You cannot change your own rank', code: 'SELF_DEMOTION' });
      const [target] = await db.select().from(transmitters).where(and(eq(transmitters.id, targetId), isNull(transmitters.deletedAt))).limit(1);
      if (!target) return reply.status(404).send({ error: 'Target transmitter not found' });
      if (target.botKind) return reply.status(400).send({ error: 'Bots cannot be staff', code: 'BOT_STAFF' });
      // Root may move other Roots; everyone else only below themselves.
      if (!auth.role.isRoot && !(await outranks(db, auth, target, reply))) return;
      let role: StaffRoleRow | null = null;
      if (roleId) {
        [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, roleId)).limit(1);
        if (!role) return reply.status(404).send({ error: 'Staff rank not found', code: 'STAFF_ROLE_NOT_FOUND' });
        if (!canManage(auth, role)) return reply.status(403).send({ error: 'You can only give ranks below your own', code: 'FORBIDDEN_STAFF_HIERARCHY' });
      }
      const before = await staffRoleOf(db, target);
      const updated = await assignStaffRole(db, targetId, role);
      await staffAudit(db, auth, {
        action: 'staff.assign',
        targetType: 'transmitter',
        targetId,
        summary: role ? `Gave ${who(target)} the ${role.name} rank` : `Removed ${who(target)} from staff`,
        details: { from: before?.name ?? null, to: role?.name ?? null },
      });
      return reply.send({ transmitter: { id: updated.id, username: updated.username, staffRank: updated.staffRank, staffRoleId: updated.staffRoleId } });
    }
  );

  // ---- Badges --------------------------------------------------------------

  async function holderCounts(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await db
      .select({ id: transmitterCommendations.commendationId, n: sql<number>`count(*)::int` })
      .from(transmitterCommendations)
      .where(inArray(transmitterCommendations.commendationId, ids))
      .groupBy(transmitterCommendations.commendationId);
    return new Map<string, number>(rows.map((r: any) => [r.id, Number(r.n)]));
  }

  app.get('/badges', async (request, reply) => {
    const auth = await requireStaff(db, request, reply);
    if (!auth) return;
    const rows = await db.select().from(commendations).where(eq(commendations.isCustom, true)).orderBy(commendations.name);
    const counts = await holderCounts(rows.map((r: any) => r.id));
    return reply.send({ badges: rows.map((b: any) => serializeBadge(b, counts.get(b.id) ?? 0)) });
  });

  const checkRule = (criteriaType: BadgeCriteria, threshold: number | undefined) =>
    RULES.includes(criteriaType) && !(threshold && threshold > 0) ? 'A rule badge needs a threshold above 0' : null;

  app.post('/badges', { schema: { body: { ...badgeBody, required: ['name', 'description', 'iconUrl', 'criteriaType'] } } }, async (request, reply) => {
    const auth = await requireStaff(db, request, reply, 'MANAGE_BADGES');
    if (!auth) return;
    const b = request.body as { name: string; description: string; iconUrl: string; criteriaType: BadgeCriteria; threshold?: number };
    const ruleError = checkRule(b.criteriaType, b.threshold);
    if (ruleError) return reply.status(400).send({ error: ruleError, code: 'INVALID_THRESHOLD' });
    if (!(await validateMediaUrl(db, auth.staffMember.id, b.iconUrl, ['badge']))) {
      return reply.status(400).send({ error: 'Upload the icon first', code: 'INVALID_MEDIA_URL' });
    }
    const id = newSnowflake();
    const [badge] = await db
      .insert(commendations)
      .values({
        id,
        code: `custom_${id}`,
        name: b.name.trim(),
        description: b.description.trim(),
        iconUrl: b.iconUrl,
        criteriaType: b.criteriaType,
        threshold: RULES.includes(b.criteriaType) ? b.threshold! : 0,
        isCustom: true,
        createdBy: auth.staffMember.id,
      })
      .returning();
    await staffAudit(db, auth, { action: 'badge.create', targetType: 'badge', targetId: badge.id, summary: `Created the ${badge.name} badge`, details: { criteriaType: b.criteriaType, threshold: badge.threshold } });
    return reply.status(201).send({ badge: serializeBadge(badge) });
  });

  async function customBadge(id: string) {
    const [badge] = await db.select().from(commendations).where(and(eq(commendations.id, id), eq(commendations.isCustom, true))).limit(1);
    return badge ?? null;
  }

  app.patch('/badges/:id', { schema: { params: idParams, body: badgeBody } }, async (request, reply) => {
    const auth = await requireStaff(db, request, reply, 'MANAGE_BADGES');
    if (!auth) return;
    const badge = await customBadge((request.params as any).id);
    if (!badge) return reply.status(404).send({ error: 'Badge not found', code: 'BADGE_NOT_FOUND' });
    const b = request.body as { name?: string; description?: string; iconUrl?: string; criteriaType?: BadgeCriteria; threshold?: number };
    const criteriaType = b.criteriaType ?? (badge.criteriaType as BadgeCriteria);
    const threshold = b.threshold ?? badge.threshold;
    const ruleError = checkRule(criteriaType, threshold);
    if (ruleError) return reply.status(400).send({ error: ruleError, code: 'INVALID_THRESHOLD' });
    if (b.iconUrl !== undefined && b.iconUrl !== badge.iconUrl && !(await validateMediaUrl(db, auth.staffMember.id, b.iconUrl, ['badge']))) {
      return reply.status(400).send({ error: 'Upload the icon first', code: 'INVALID_MEDIA_URL' });
    }
    const set: Record<string, unknown> = {};
    if (b.name !== undefined) set.name = b.name.trim();
    if (b.description !== undefined) set.description = b.description.trim();
    if (b.iconUrl !== undefined) set.iconUrl = b.iconUrl;
    set.criteriaType = criteriaType;
    set.threshold = RULES.includes(criteriaType) ? threshold : 0;
    const [updated] = await db.update(commendations).set(set).where(eq(commendations.id, badge.id)).returning();
    // A badge no longer awarded by rank is unpinned from the ranks that wore it.
    if (badge.criteriaType === 'staff_role' && criteriaType !== 'staff_role') await db.update(staffRoles).set({ badgeId: null }).where(eq(staffRoles.badgeId, badge.id));
    await staffAudit(db, auth, { action: 'badge.update', targetType: 'badge', targetId: badge.id, summary: `Changed the ${updated.name} badge`, details: b });
    return reply.send({ badge: serializeBadge(updated, (await holderCounts([badge.id])).get(badge.id) ?? 0) });
  });

  app.delete('/badges/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await requireStaff(db, request, reply, 'MANAGE_BADGES');
    if (!auth) return;
    const badge = await customBadge((request.params as any).id);
    if (!badge) return reply.status(404).send({ error: 'Badge not found', code: 'BADGE_NOT_FOUND' });
    // Everyone loses it (cascade); ranks wearing it go back to the generic Staff badge.
    await db.delete(commendations).where(eq(commendations.id, badge.id));
    await staffAudit(db, auth, { action: 'badge.delete', targetType: 'badge', targetId: badge.id, summary: `Deleted the ${badge.name} badge` });
    return reply.send({ deleted: true });
  });

  app.get('/badges/:id/holders', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await requireStaff(db, request, reply);
    if (!auth) return;
    const badge = await customBadge((request.params as any).id);
    if (!badge) return reply.status(404).send({ error: 'Badge not found', code: 'BADGE_NOT_FOUND' });
    const holders = await db
      .select({ id: transmitters.id, username: transmitters.username, discriminator: transmitters.discriminator, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl, awardedAt: transmitterCommendations.awardedAt })
      .from(transmitterCommendations)
      .innerJoin(transmitters, eq(transmitterCommendations.transmitterId, transmitters.id))
      .where(and(eq(transmitterCommendations.commendationId, badge.id), isNull(transmitters.deletedAt)))
      .orderBy(desc(transmitterCommendations.awardedAt))
      .limit(200);
    return reply.send({ holders });
  });

  app.post(
    '/badges/:id/holders',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['transmitterId'], properties: { transmitterId: ID } } } },
    async (request, reply) => {
      const auth = await requireStaff(db, request, reply, 'MANAGE_BADGES');
      if (!auth) return;
      const badge = await customBadge((request.params as any).id);
      if (!badge) return reply.status(404).send({ error: 'Badge not found', code: 'BADGE_NOT_FOUND' });
      if (badge.criteriaType !== 'manual') return reply.status(400).send({ error: 'This badge is awarded automatically', code: 'BADGE_NOT_MANUAL' });
      const { transmitterId } = request.body as { transmitterId: string };
      const [target] = await db.select().from(transmitters).where(and(eq(transmitters.id, transmitterId), isNull(transmitters.deletedAt))).limit(1);
      if (!target) return reply.status(404).send({ error: 'Target transmitter not found' });
      await db.insert(transmitterCommendations).values({ transmitterId, commendationId: badge.id, displayOrder: 100 }).onConflictDoNothing();
      await staffAudit(db, auth, { action: 'badge.award', targetType: 'transmitter', targetId: transmitterId, summary: `Gave ${who(target)} the ${badge.name} badge`, details: { badgeId: badge.id } });
      return reply.status(201).send({ awarded: true });
    }
  );

  app.delete(
    '/badges/:id/holders/:transmitterId',
    { schema: { params: { type: 'object', properties: { id: ID, transmitterId: ID } } } },
    async (request, reply) => {
      const auth = await requireStaff(db, request, reply, 'MANAGE_BADGES');
      if (!auth) return;
      const { id, transmitterId } = request.params as { id: string; transmitterId: string };
      const badge = await customBadge(id);
      if (!badge) return reply.status(404).send({ error: 'Badge not found', code: 'BADGE_NOT_FOUND' });
      if (badge.criteriaType !== 'manual') return reply.status(400).send({ error: 'This badge is awarded automatically', code: 'BADGE_NOT_MANUAL' });
      const removed = await db
        .delete(transmitterCommendations)
        .where(and(eq(transmitterCommendations.commendationId, badge.id), eq(transmitterCommendations.transmitterId, transmitterId)))
        .returning({ id: transmitterCommendations.transmitterId });
      if (!removed.length) return reply.status(404).send({ error: 'They do not have this badge', code: 'NOT_HELD' });
      const [target] = await db.select().from(transmitters).where(eq(transmitters.id, transmitterId)).limit(1);
      await staffAudit(db, auth, { action: 'badge.revoke', targetType: 'transmitter', targetId: transmitterId, summary: `Took the ${badge.name} badge from ${target ? who(target) : transmitterId}`, details: { badgeId: badge.id } });
      return reply.send({ revoked: true });
    }
  );

  app.get('/transmitters/:id/badges', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await requireStaff(db, request, reply, 'MANAGE_BADGES');
    if (!auth) return;
    const targetId = (request.params as any).id as string;
    const manual = await db.select().from(commendations).where(and(eq(commendations.isCustom, true), eq(commendations.criteriaType, 'manual'))).orderBy(commendations.name);
    const held = new Set(
      (await db.select({ id: transmitterCommendations.commendationId }).from(transmitterCommendations).where(eq(transmitterCommendations.transmitterId, targetId))).map((r: any) => r.id)
    );
    return reply.send({ badges: manual.map((b: any) => ({ ...serializeBadge(b), held: held.has(b.id) })) });
  });

  // ---- Staff log -----------------------------------------------------------

  app.get(
    '/audit-log',
    { schema: { querystring: { type: 'object', properties: { before: ID, limit: { type: 'integer', minimum: 1, maximum: 100 } } } } },
    async (request, reply) => {
      const auth = await requireStaff(db, request, reply, 'VIEW_AUDIT_LOG');
      if (!auth) return;
      const { before, limit = 50 } = request.query as { before?: string; limit?: number };
      const entries = await db
        .select({
          id: staffAuditLog.id,
          action: staffAuditLog.action,
          summary: staffAuditLog.summary,
          targetType: staffAuditLog.targetType,
          targetId: staffAuditLog.targetId,
          details: staffAuditLog.details,
          createdAt: staffAuditLog.createdAt,
          actor: { id: transmitters.id, username: transmitters.username, discriminator: transmitters.discriminator, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl },
        })
        .from(staffAuditLog)
        .leftJoin(transmitters, eq(staffAuditLog.actorId, transmitters.id))
        .where(before ? lt(staffAuditLog.id, before) : undefined)
        .orderBy(desc(staffAuditLog.id))
        .limit(limit);
      return reply.send({ entries: entries.map((e: any) => ({ ...e, actor: e.actor?.id ? e.actor : null })), hasMore: entries.length === limit });
    }
  );
};
