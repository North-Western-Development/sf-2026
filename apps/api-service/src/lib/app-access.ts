import { and, eq, isNotNull, devTeams, devTeamMembers, oauthApps } from '@subspace/database';
import { appRoleAtLeast, type AppRole, type DevTeamRole } from '@subspace/constants';

/**
 * Who can do what with an application: its owner, or the members of the development team it
 * belongs to, as their role allows (DEV_TEAM_ROLES). A pending invitation gives no access.
 */
export async function appRole(db: any, app: { ownerId: string; teamId?: string | null }, transmitterId: string): Promise<AppRole | null> {
  if (!app.teamId) return app.ownerId === transmitterId ? 'owner' : null;
  return teamRole(db, app.teamId, transmitterId);
}

/** Their role in a team: 'owner', an accepted member's role, or null. */
export async function teamRole(db: any, teamId: string, transmitterId: string): Promise<AppRole | null> {
  const [team] = await db.select({ ownerId: devTeams.ownerId }).from(devTeams).where(eq(devTeams.id, teamId)).limit(1);
  if (!team) return null;
  if (team.ownerId === transmitterId) return 'owner';
  const [member] = await db
    .select({ role: devTeamMembers.role })
    .from(devTeamMembers)
    .where(and(eq(devTeamMembers.teamId, teamId), eq(devTeamMembers.transmitterId, transmitterId), isNotNull(devTeamMembers.acceptedAt)))
    .limit(1);
  return (member?.role as DevTeamRole | undefined) ?? null;
}

/**
 * The application if they have at least `needed` on it. Someone without any access gets the same
 * answer as for an application that does not exist; someone with too little is told so.
 */
export async function appWithRole(db: any, appId: string, transmitterId: string, needed: AppRole) {
  const [app] = await db.select().from(oauthApps).where(eq(oauthApps.id, appId)).limit(1);
  if (!app) return { error: 404 as const };
  const role = await appRole(db, app, transmitterId);
  if (!role) return { error: 404 as const };
  if (!appRoleAtLeast(role, needed)) return { error: 403 as const, role };
  return { app, role };
}
