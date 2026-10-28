import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { STAFF_PERMISSIONS as P, ALL_STAFF_PERMISSIONS } from '@subspace/constants';
import { transmitters, staffRoles, staffAuditLog, commendations, mediaUploads, eq, or, inArray } from '@subspace/database';

/** Command Console: custom staff ranks, staff members, custom badges and the staff log. */
describe('Staff ranks, badges and the staff log', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const root = { id: '801756946623498001', username: 'stc_root' };
  const admin = { id: '801756946623498002', username: 'stc_admin' };
  const helper = { id: '801756946623498003', username: 'stc_helper' };
  const member = { id: '801756946623498004', username: 'stc_member' };
  const veteran = { id: '801756946623498005', username: 'stc_veteran' };
  const users = [root, admin, helper, member, veteran];
  const ids = users.map((u) => u.id);
  const auth = (u: { id: string; username: string }) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (u: { id: string; username: string }, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  const createdRoles: string[] = [];
  const createdBadges: string[] = [];
  let iconUrl = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(transmitters).where(inArray(transmitters.id, ids));
    const base = { passwordHash: 'x', isEmailVerified: true };
    await db.insert(transmitters).values([
      { ...base, id: root.id, username: root.username, email: 'stc_root@subspace.test', displayName: 'Root One', staffRank: 3 },
      { ...base, id: admin.id, username: admin.username, email: 'stc_admin@subspace.test', displayName: 'Admin One', staffRank: 2 },
      { ...base, id: helper.id, username: helper.username, email: 'stc_helper@subspace.test', displayName: 'Helper One' },
      { ...base, id: member.id, username: member.username, email: 'stc_member@subspace.test', displayName: 'Member One' },
      { ...base, id: veteran.id, username: veteran.username, email: 'stc_veteran@subspace.test', displayName: 'Veteran', createdAt: new Date(Date.now() - 400 * 86_400_000) },
    ]);
    // A verified badge icon the root uploaded.
    iconUrl = `/subspace-media/badge/${Date.now()}.png`;
    await db.insert(mediaUploads).values({ ownerId: root.id, purpose: 'badge', mimeType: 'image/png', declaredSizeBytes: 100n, storageKey: iconUrl.slice(16), publicUrl: iconUrl, verified: true });
  });

  afterAll(async () => {
    if (db) {
      await db.delete(staffAuditLog).where(inArray(staffAuditLog.actorId, ids));
      if (createdBadges.length) await db.delete(commendations).where(inArray(commendations.id, createdBadges));
      if (createdRoles.length) await db.delete(staffRoles).where(inArray(staffRoles.id, createdRoles));
      await db.delete(transmitters).where(inArray(transmitters.id, ids));
    }
    await app.close();
  });

  it('resolves the built-in ranks for accounts that only have a staff_rank', async () => {
    if (!db) return;
    const me = (await call(root, 'GET', '/console/me')).json();
    expect(me.role).toMatchObject({ name: expect.any(String), isRoot: true, builtIn: true });
    expect(me.permissions).toBe(ALL_STAFF_PERMISSIONS);
    const adminMe = (await call(admin, 'GET', '/console/me')).json();
    expect(adminMe.role.isRoot).toBe(false);
    expect(adminMe.permissions & P.MANAGE_STAFF).toBe(0);
    expect((await call(member, 'GET', '/console/me')).statusCode).toBe(403);
    // Admin cannot manage staff (the built-in Admin rank has no MANAGE_STAFF).
    expect((await call(admin, 'POST', '/console/staff-roles', { name: 'Nope' })).json().code).toBe('INSUFFICIENT_STAFF_RANK');
  });

  it('creates a rank, gives it to someone, and their permissions follow it', async () => {
    if (!db) return;
    const created = await call(root, 'POST', '/console/staff-roles', { name: 'Support', color: '#22AA88', permissions: P.VIEW_REPORTS | P.QUARANTINE });
    expect(created.statusCode).toBe(201);
    const support = created.json().role;
    createdRoles.push(support.id);
    // New ranks start at the bottom, below the built-in Moderator.
    const { roles } = (await call(root, 'GET', '/console/staff-roles')).json();
    expect(roles[roles.length - 1].id).toBe(support.id);

    expect((await call(root, 'PATCH', `/console/transmitters/${helper.id}/staff-role`, { roleId: support.id })).statusCode).toBe(200);
    const [row] = await db.select().from(transmitters).where(eq(transmitters.id, helper.id));
    expect(row).toMatchObject({ staffRoleId: support.id, staffRank: 1 });
    expect((await call(helper, 'GET', '/console/me')).json().permissions).toBe(P.VIEW_REPORTS | P.QUARANTINE);
    expect((await call(helper, 'GET', '/console/reports')).statusCode).toBe(200);
    expect((await call(helper, 'POST', `/console/transmitters/${member.id}/ban`, {})).json().code).toBe('INSUFFICIENT_STAFF_RANK');
    expect((await call(helper, 'POST', `/console/transmitters/${member.id}/quarantine`, {})).statusCode).toBe(200);
    await call(helper, 'POST', `/console/transmitters/${member.id}/unquarantine`, {});
    // Never on someone at or above their rank.
    expect((await call(helper, 'POST', `/console/transmitters/${admin.id}/quarantine`, {})).json().code).toBe('FORBIDDEN_STAFF_HIERARCHY');

    // Staff list shows them under their rank.
    const { staff } = (await call(helper, 'GET', '/console/staff')).json();
    expect(staff.find((s: any) => s.id === helper.id).role.name).toBe('Support');
  });

  it('lets staff with Manage Staff act only below themselves and never grant what they lack', async () => {
    if (!db) return;
    const lead = (await call(root, 'POST', '/console/staff-roles', { name: 'Team Lead', permissions: P.MANAGE_STAFF | P.VIEW_REPORTS })).json().role;
    createdRoles.push(lead.id);
    const { roles } = (await call(root, 'GET', '/console/staff-roles')).json();
    const support = roles.find((r: any) => r.name === 'Support');
    // Put Team Lead above Support (it was created below it).
    const order = roles.filter((r: any) => !r.isRoot).map((r: any) => r.id);
    const reordered = [...order.filter((id: string) => id !== lead.id && id !== support.id), lead.id, support.id];
    expect((await call(root, 'PUT', '/console/staff-roles/order', { ids: reordered })).statusCode).toBe(200);
    await call(root, 'PATCH', `/console/transmitters/${admin.id}/staff-role`, { roleId: lead.id });

    // The lead (now admin's rank) can give Support, but not their own rank or anything above.
    expect((await call(admin, 'PATCH', `/console/transmitters/${member.id}/staff-role`, { roleId: support.id })).statusCode).toBe(200);
    expect((await call(admin, 'PATCH', `/console/transmitters/${member.id}/staff-role`, { roleId: lead.id })).json().code).toBe('FORBIDDEN_STAFF_HIERARCHY');
    expect((await call(admin, 'PATCH', `/console/transmitters/${root.id}/staff-role`, { roleId: null })).json().code).toBe('FORBIDDEN_STAFF_HIERARCHY');
    expect((await call(admin, 'PATCH', `/console/transmitters/${admin.id}/staff-role`, { roleId: null })).json().code).toBe('SELF_DEMOTION');
    // Can edit Support, but not give it powers they do not have.
    expect((await call(admin, 'PATCH', `/console/staff-roles/${support.id}`, { permissions: P.VIEW_REPORTS })).statusCode).toBe(200);
    expect((await call(admin, 'PATCH', `/console/staff-roles/${support.id}`, { permissions: P.SUSPEND })).json().code).toBe('PERMISSION_ESCALATION');
    expect((await call(admin, 'PATCH', `/console/staff-roles/${lead.id}`, { name: 'Boss' })).json().code).toBe('FORBIDDEN_STAFF_HIERARCHY');
    // Root's rank cannot be deleted.
    const rootRole = roles.find((r: any) => r.isRoot);
    expect((await call(root, 'DELETE', `/console/staff-roles/${rootRole.id}`)).json().code).toBe('ROOT_ROLE');

    // Deleting a rank takes its holders out of staff.
    const del = await call(root, 'DELETE', `/console/staff-roles/${support.id}`);
    expect(del.json()).toMatchObject({ deleted: true, membersRemoved: 2 });
    const left = await db.select().from(transmitters).where(inArray(transmitters.id, [helper.id, member.id]));
    expect(left.every((u: any) => u.staffRank === 0 && u.staffRoleId === null)).toBe(true);
    // Back to the built-in Admin for the next tests.
    await call(root, 'PATCH', `/console/transmitters/${admin.id}/staff-rank`, { staffRank: 2 });
  });

  it('makes custom badges: hand-awarded, earned by a rule, and worn by a staff rank', async () => {
    if (!db) return;
    // Icons must be the creator's own verified badge upload.
    expect((await call(root, 'POST', '/console/badges', { name: 'X', description: 'Y', iconUrl: '/subspace-media/badge/nope.png', criteriaType: 'manual' })).json().code).toBe('INVALID_MEDIA_URL');
    const helperBadge = (await call(root, 'POST', '/console/badges', { name: 'Bug Hunter', description: 'Found a real bug', iconUrl, criteriaType: 'manual' })).json().badge;
    const ruleBadge = (await call(root, 'POST', '/console/badges', { name: 'Old Timer', description: 'A year aboard', iconUrl, criteriaType: 'account_age', threshold: 365 })).json().badge;
    const rankBadge = (await call(root, 'POST', '/console/badges', { name: 'Root Crew', description: 'Runs this instance', iconUrl, criteriaType: 'staff_role' })).json().badge;
    createdBadges.push(helperBadge.id, ruleBadge.id, rankBadge.id);
    expect((await call(root, 'POST', '/console/badges', { name: 'Bad', description: 'No threshold', iconUrl, criteriaType: 'voice_minutes' })).json().code).toBe('INVALID_THRESHOLD');

    const profileBadges = async (u: { id: string }) => (await call(root, 'GET', `/users/${u.id}/profile`)).json().commendations.map((c: any) => c.name);

    // Hand-awarded.
    expect((await call(root, 'POST', `/console/badges/${helperBadge.id}/holders`, { transmitterId: member.id })).statusCode).toBe(201);
    expect(await profileBadges(member)).toContain('Bug Hunter');
    expect((await call(root, 'GET', `/console/transmitters/${member.id}/badges`)).json().badges.find((b: any) => b.id === helperBadge.id).held).toBe(true);
    expect((await call(root, 'POST', `/console/badges/${ruleBadge.id}/holders`, { transmitterId: member.id })).json().code).toBe('BADGE_NOT_MANUAL');
    expect((await call(root, 'DELETE', `/console/badges/${helperBadge.id}/holders/${member.id}`)).statusCode).toBe(200);
    expect(await profileBadges(member)).not.toContain('Bug Hunter');

    // Earned by a rule when the profile is next viewed; a new account does not qualify.
    expect(await profileBadges(veteran)).toContain('Old Timer');
    expect(await profileBadges(member)).not.toContain('Old Timer');

    // Worn by a rank, in place of the generic Staff badge, and gone with the rank.
    const rootRole = (await call(root, 'GET', '/console/me')).json().role;
    expect((await call(root, 'PATCH', `/console/staff-roles/${rootRole.id}`, { badgeId: helperBadge.id })).json().code).toBe('INVALID_BADGE');
    expect((await call(root, 'PATCH', `/console/staff-roles/${rootRole.id}`, { badgeId: rankBadge.id })).statusCode).toBe(200);
    const rootBadges = await profileBadges(root);
    expect(rootBadges[0]).toBe('Root Crew');
    expect((await call(admin, 'GET', `/users/${admin.id}/profile`)).json().commendations.some((c: any) => c.name === 'Root Crew')).toBe(false);
    await call(root, 'PATCH', `/console/staff-roles/${rootRole.id}`, { badgeId: null });
    expect(await profileBadges(root)).not.toContain('Root Crew');

    // A demoted staff member loses the Staff badge.
    await call(root, 'PATCH', `/console/transmitters/${helper.id}/staff-rank`, { staffRank: 1 });
    const staffBadge = async () => (await call(root, 'GET', `/users/${helper.id}/profile`)).json().commendations.length;
    const withStaff = await staffBadge();
    await call(root, 'PATCH', `/console/transmitters/${helper.id}/staff-rank`, { staffRank: 0 });
    expect(await staffBadge()).toBe(withStaff - 1);

    // Deleting a badge takes it from everyone.
    await call(root, 'POST', `/console/badges/${helperBadge.id}/holders`, { transmitterId: member.id });
    expect((await call(root, 'DELETE', `/console/badges/${helperBadge.id}`)).statusCode).toBe(200);
    expect(await profileBadges(member)).not.toContain('Bug Hunter');
  });

  it('records staff actions in the staff log, newest first, for ranks allowed to read it', async () => {
    if (!db) return;
    const log = await call(root, 'GET', '/console/audit-log?limit=100');
    expect(log.statusCode).toBe(200);
    const actions = log.json().entries.filter((e: any) => ids.includes(e.actor?.id)).map((e: any) => e.action);
    for (const a of ['staff_role.create', 'staff.assign', 'staff_role.reorder', 'staff_role.delete', 'transmitter.quarantine', 'badge.create', 'badge.award', 'badge.revoke', 'badge.delete']) {
      expect(actions, a).toContain(a);
    }
    const page = (await call(root, 'GET', '/console/audit-log?limit=2')).json();
    expect(page.entries).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const next = (await call(root, 'GET', `/console/audit-log?limit=2&before=${page.entries[1].id}`)).json();
    expect(BigInt(next.entries[0].id) < BigInt(page.entries[1].id)).toBe(true);
    // Staff whose rank cannot read it are refused.
    const quiet = (await call(root, 'POST', '/console/staff-roles', { name: 'Quiet', permissions: P.VIEW_REPORTS })).json().role;
    createdRoles.push(quiet.id);
    await call(root, 'PATCH', `/console/transmitters/${helper.id}/staff-role`, { roleId: quiet.id });
    expect((await call(helper, 'GET', '/console/audit-log')).json().code).toBe('INSUFFICIENT_STAFF_RANK');
  });

  it('keeps the built-in ranks after the instance restarts', async () => {
    if (!db) return;
    const builtIn = await db.select().from(staffRoles).where(or(eq(staffRoles.legacyRank, 1), eq(staffRoles.legacyRank, 2), eq(staffRoles.legacyRank, 3)));
    expect(builtIn).toHaveLength(3);
  });
});
