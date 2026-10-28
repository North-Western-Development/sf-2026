import { eq, inArray } from 'drizzle-orm';
import { ALL_STAFF_PERMISSIONS, STAFF_PERMISSIONS as P } from '@subspace/constants';
import { staffRoles, transmitters } from './schema.js';

export type StaffRoleRow = typeof staffRoles.$inferSelect;

/** The built-in ranks, created once and then edited (or deleted) like any other. */
export const DEFAULT_STAFF_ROLES = [
  { legacyRank: 3, name: 'Root', color: '#F2C94C', position: 1000, isRoot: true, permissions: ALL_STAFF_PERMISSIONS },
  {
    legacyRank: 2,
    name: 'Admin',
    color: '#EB5757',
    position: 200,
    isRoot: false,
    permissions: P.VIEW_REPORTS | P.QUARANTINE | P.SUSPEND | P.MANAGE_VAULT | P.MANAGE_STORAGE | P.MANAGE_DISCOVERY | P.MANAGE_BADGES | P.VIEW_AUDIT_LOG,
  },
  { legacyRank: 1, name: 'Moderator', color: '#3B8EF2', position: 100, isRoot: false, permissions: P.VIEW_REPORTS | P.QUARANTINE | P.MANAGE_VAULT | P.VIEW_AUDIT_LOG },
] as const;

/** Creates any missing built-in rank (run at API startup). Existing ones are left as edited. */
export async function ensureDefaultStaffRoles(db: any) {
  const have = new Set(
    (await db.select({ legacyRank: staffRoles.legacyRank }).from(staffRoles).where(inArray(staffRoles.legacyRank, [1, 2, 3]))).map((r: any) => r.legacyRank)
  );
  for (const r of DEFAULT_STAFF_ROLES) {
    if (!have.has(r.legacyRank)) await db.insert(staffRoles).values({ ...r }).onConflictDoNothing();
  }
}

/**
 * Someone's staff rank: the one assigned to them, else the built-in rank their staff_rank stands
 * for. Null for everyone who is not staff.
 */
export async function staffRoleOf(db: any, user: { staffRank?: number | null; staffRoleId?: string | null }): Promise<StaffRoleRow | null> {
  if (user.staffRoleId) {
    const [role] = await db.select().from(staffRoles).where(eq(staffRoles.id, user.staffRoleId)).limit(1);
    if (role) return role;
  }
  const rank = Math.min(user.staffRank ?? 0, 3);
  if (rank <= 0) return null;
  const [role] = await db.select().from(staffRoles).where(eq(staffRoles.legacyRank, rank)).limit(1);
  return role ?? null;
}

/** What a rank allows: Root always everything. */
export const rolePermissions = (role: Pick<StaffRoleRow, 'isRoot' | 'permissions'> | null) => (!role ? 0 : role.isRoot ? ALL_STAFF_PERMISSIONS : role.permissions);

/** Where someone stands: 0 for non-staff, so any staff rank outranks them. */
export const rolePosition = (role: Pick<StaffRoleRow, 'position'> | null) => (role ? Math.max(1, role.position) : 0);

/**
 * The staff_rank number to store with a rank, which the rest of the app reads as "is staff"
 * (badges, the Staff tag on messages, tokens): built-in ranks keep theirs, custom ones are 1.
 */
export const legacyRankFor = (role: Pick<StaffRoleRow, 'legacyRank' | 'isRoot'> | null) => (!role ? 0 : role.isRoot ? 3 : role.legacyRank ?? 1);

/** Puts an account in a rank (or out of staff, with null). */
export async function assignStaffRole(db: any, transmitterId: string, role: StaffRoleRow | null) {
  const [row] = await db
    .update(transmitters)
    .set({ staffRoleId: role?.id ?? null, staffRank: legacyRankFor(role), updatedAt: new Date() })
    .where(eq(transmitters.id, transmitterId))
    .returning();
  return row ?? null;
}
