import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, inArray, isNull, devTeams, devTeamMembers, oauthApps, transmitters, loadDeveloperPolicy, accountVerification } from '@subspace/database';
import { DEV_TEAM_ROLES, appCreationCheck, appRoleAtLeast, type DevTeamRole } from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { teamRole } from '../../lib/app-access.js';

const ID = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const MAX_TEAMS = 10;
const MAX_MEMBERS = 25;

/**
 * Development teams (Discord's): several people sharing applications.
 *   GET    /teams                                  my teams and my pending invitations
 *   POST   /teams                                  { name }
 *   PATCH  /teams/:id                              { name }                    admin
 *   DELETE /teams/:id                              owner: its applications go back to the owner
 *   POST   /teams/:id/members                      { username, discriminator, role }  admin (admins: owner only)
 *   PATCH  /teams/:id/members/:userId              { role }                    admin
 *   DELETE /teams/:id/members/:userId              admin, or yourself (leave / decline)
 *   POST   /teams/:id/accept                       accept my invitation
 *   POST   /applications/:id/team                  { teamId | null }  move an application in or out
 */
export const teamRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  const me = (request: any, reply: any): string | null => {
    const token = extractAuthToken(request) as any;
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (token.bot) return reply.status(403).send({ error: 'Bots cannot manage teams', code: 'BOT_FORBIDDEN' }), null;
    return token.transmitterId;
  };

  const person = { id: transmitters.id, username: transmitters.username, discriminator: transmitters.discriminator, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl };

  /** A team with its owner, members (pending ones marked), applications, and my role. */
  async function teamView(teamId: string, viewer: string) {
    const [team] = await db.select().from(devTeams).where(eq(devTeams.id, teamId)).limit(1);
    if (!team) return null;
    const [owner] = await db.select(person).from(transmitters).where(eq(transmitters.id, team.ownerId)).limit(1);
    const members = await db
      .select({ ...person, role: devTeamMembers.role, acceptedAt: devTeamMembers.acceptedAt })
      .from(devTeamMembers)
      .innerJoin(transmitters, eq(transmitters.id, devTeamMembers.transmitterId))
      .where(eq(devTeamMembers.teamId, teamId))
      .orderBy(devTeamMembers.createdAt);
    const apps = await db.select({ id: oauthApps.id, name: oauthApps.name, iconUrl: oauthApps.iconUrl }).from(oauthApps).where(eq(oauthApps.teamId, teamId));
    return {
      id: team.id,
      name: team.name,
      owner,
      myRole: await teamRole(db, teamId, viewer),
      members: members.map((m: any) => ({ ...m, pending: !m.acceptedAt, acceptedAt: undefined })),
      applications: apps,
      createdAt: team.createdAt,
    };
  }

  /** The team in the URL if I have at least `needed` in it. */
  async function teamFor(request: any, reply: any, needed: 'read_only' | 'admin' | 'owner') {
    const viewer = me(request, reply);
    if (!viewer) return null;
    const { id } = request.params as { id: string };
    const role = await teamRole(db, id, viewer);
    if (!role) return reply.status(404).send({ error: 'Team not found', code: 'UNKNOWN_TEAM' }), null;
    if (!appRoleAtLeast(role, needed)) return reply.status(403).send({ error: 'Your team role does not allow that', code: 'TEAM_ROLE_TOO_LOW' }), null;
    const [team] = await db.select().from(devTeams).where(eq(devTeams.id, id)).limit(1);
    return { viewer, role, team };
  }

  app.get('/teams', async (request, reply) => {
    const viewer = me(request, reply);
    if (!viewer) return;
    const owned = await db.select({ id: devTeams.id }).from(devTeams).where(eq(devTeams.ownerId, viewer));
    const memberships = await db.select({ id: devTeamMembers.teamId, acceptedAt: devTeamMembers.acceptedAt }).from(devTeamMembers).where(eq(devTeamMembers.transmitterId, viewer));
    const ids = [...owned.map((t: any) => t.id), ...memberships.filter((m: any) => m.acceptedAt).map((m: any) => m.id)];
    const teams = (await Promise.all(ids.map((id) => teamView(id, viewer)))).filter(Boolean);
    const pendingIds = memberships.filter((m: any) => !m.acceptedAt).map((m: any) => m.id);
    const invitations = pendingIds.length
      ? await db
          .select({ teamId: devTeams.id, name: devTeams.name, role: devTeamMembers.role, owner: transmitters.username })
          .from(devTeamMembers)
          .innerJoin(devTeams, eq(devTeams.id, devTeamMembers.teamId))
          .innerJoin(transmitters, eq(transmitters.id, devTeams.ownerId))
          .where(and(eq(devTeamMembers.transmitterId, viewer), inArray(devTeamMembers.teamId, pendingIds)))
      : [];
    return reply.send({ teams, invitations });
  });

  app.post('/teams', { schema: { body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 2, maxLength: 40 } } } } }, async (request, reply) => {
    const viewer = me(request, reply);
    if (!viewer) return;
    // Teams are for building applications: the same rule as creating one.
    const check = appCreationCheck(await accountVerification(db, viewer), await loadDeveloperPolicy(db));
    if (!check.allowed) return reply.status(403).send({ error: `Creating teams here needs ${check.missing.join(' and ')}`, code: 'APP_CREATION_RESTRICTED', missing: check.missing });
    const owned = await db.select({ id: devTeams.id }).from(devTeams).where(eq(devTeams.ownerId, viewer));
    if (owned.length >= MAX_TEAMS) return reply.status(400).send({ error: `You can own up to ${MAX_TEAMS} teams`, code: 'MAX_TEAMS' });
    const [team] = await db.insert(devTeams).values({ name: (request.body as { name: string }).name.trim(), ownerId: viewer }).returning();
    return reply.status(201).send({ team: await teamView(team.id, viewer) });
  });

  app.patch(
    '/teams/:id',
    { schema: { params: { type: 'object', properties: { id: ID } }, body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 2, maxLength: 40 } } } } },
    async (request, reply) => {
      const ctx = await teamFor(request, reply, 'admin');
      if (!ctx) return;
      await db.update(devTeams).set({ name: (request.body as { name: string }).name.trim() }).where(eq(devTeams.id, ctx.team.id));
      return reply.send({ team: await teamView(ctx.team.id, ctx.viewer) });
    }
  );

  app.delete('/teams/:id', { schema: { params: { type: 'object', properties: { id: ID } } } }, async (request, reply) => {
    const ctx = await teamFor(request, reply, 'owner');
    if (!ctx) return;
    // Its applications stay with the team's owner (who already owns them).
    await db.update(oauthApps).set({ teamId: null }).where(eq(oauthApps.teamId, ctx.team.id));
    await db.delete(devTeams).where(eq(devTeams.id, ctx.team.id));
    return reply.status(204).send();
  });

  const roleSchema = { type: 'string', enum: [...DEV_TEAM_ROLES] };

  app.post(
    '/teams/:id/members',
    {
      schema: {
        params: { type: 'object', properties: { id: ID } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'discriminator', 'role'],
          properties: { username: { type: 'string', minLength: 1, maxLength: 64 }, discriminator: { type: 'string', pattern: '^[0-9]{4}$' }, role: roleSchema },
        },
      },
    },
    async (request, reply) => {
      const ctx = await teamFor(request, reply, 'admin');
      if (!ctx) return;
      const body = request.body as { username: string; discriminator: string; role: DevTeamRole };
      if (body.role === 'admin' && ctx.role !== 'owner') return reply.status(403).send({ error: 'Only the owner adds admins', code: 'TEAM_ROLE_TOO_LOW' });
      const [target] = await db
        .select({ id: transmitters.id, botKind: transmitters.botKind })
        .from(transmitters)
        .where(and(eq(transmitters.username, body.username.trim()), eq(transmitters.discriminator, body.discriminator), isNull(transmitters.deletedAt)))
        .limit(1);
      if (!target || target.botKind) return reply.status(404).send({ error: 'No one by that name', code: 'UNKNOWN_TRANSMITTER' });
      if (target.id === ctx.team.ownerId) return reply.status(400).send({ error: 'They own this team', code: 'ALREADY_MEMBER' });
      const members = await db.select({ id: devTeamMembers.transmitterId }).from(devTeamMembers).where(eq(devTeamMembers.teamId, ctx.team.id));
      if (members.some((m: any) => m.id === target.id)) return reply.status(409).send({ error: 'Already a member or invited', code: 'ALREADY_MEMBER' });
      if (members.length >= MAX_MEMBERS) return reply.status(400).send({ error: `A team can have up to ${MAX_MEMBERS} members`, code: 'MAX_MEMBERS' });
      // An invitation: they join when they accept it.
      await db.insert(devTeamMembers).values({ teamId: ctx.team.id, transmitterId: target.id, role: body.role, invitedBy: ctx.viewer });
      return reply.status(201).send({ team: await teamView(ctx.team.id, ctx.viewer) });
    }
  );

  app.patch(
    '/teams/:id/members/:userId',
    { schema: { params: { type: 'object', properties: { id: ID, userId: ID } }, body: { type: 'object', additionalProperties: false, required: ['role'], properties: { role: roleSchema } } } },
    async (request, reply) => {
      const ctx = await teamFor(request, reply, 'admin');
      if (!ctx) return;
      const { userId } = request.params as { userId: string };
      const { role } = request.body as { role: DevTeamRole };
      const [member] = await db.select().from(devTeamMembers).where(and(eq(devTeamMembers.teamId, ctx.team.id), eq(devTeamMembers.transmitterId, userId))).limit(1);
      if (!member) return reply.status(404).send({ error: 'Not a member', code: 'UNKNOWN_MEMBER' });
      // Admins manage developers and read-only members; only the owner makes or unmakes admins.
      if ((member.role === 'admin' || role === 'admin') && ctx.role !== 'owner') return reply.status(403).send({ error: 'Only the owner changes admins', code: 'TEAM_ROLE_TOO_LOW' });
      await db.update(devTeamMembers).set({ role }).where(and(eq(devTeamMembers.teamId, ctx.team.id), eq(devTeamMembers.transmitterId, userId)));
      return reply.send({ team: await teamView(ctx.team.id, ctx.viewer) });
    }
  );

  app.delete('/teams/:id/members/:userId', { schema: { params: { type: 'object', properties: { id: ID, userId: ID } } } }, async (request, reply) => {
    const viewer = me(request, reply);
    if (!viewer) return;
    const { id, userId } = request.params as { id: string; userId: string };
    const [member] = await db.select().from(devTeamMembers).where(and(eq(devTeamMembers.teamId, id), eq(devTeamMembers.transmitterId, userId))).limit(1);
    // Anyone can leave a team, or decline an invitation.
    if (userId !== viewer) {
      const role = await teamRole(db, id, viewer);
      if (!role) return reply.status(404).send({ error: 'Team not found', code: 'UNKNOWN_TEAM' });
      if (!appRoleAtLeast(role, 'admin') || (member?.role === 'admin' && role !== 'owner')) return reply.status(403).send({ error: 'Your team role does not allow that', code: 'TEAM_ROLE_TOO_LOW' });
    }
    if (!member) return reply.status(404).send({ error: 'Not a member', code: 'UNKNOWN_MEMBER' });
    await db.delete(devTeamMembers).where(and(eq(devTeamMembers.teamId, id), eq(devTeamMembers.transmitterId, userId)));
    return reply.status(204).send();
  });

  app.post('/teams/:id/accept', { schema: { params: { type: 'object', properties: { id: ID } } } }, async (request, reply) => {
    const viewer = me(request, reply);
    if (!viewer) return;
    const { id } = request.params as { id: string };
    const [updated] = await db
      .update(devTeamMembers)
      .set({ acceptedAt: new Date() })
      .where(and(eq(devTeamMembers.teamId, id), eq(devTeamMembers.transmitterId, viewer), isNull(devTeamMembers.acceptedAt)))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'No invitation to that team', code: 'UNKNOWN_INVITATION' });
    return reply.send({ team: await teamView(id, viewer) });
  });

  /**
   * Move an application into a team (its owner, who must be an admin or the owner of the team) or
   * out of one (the team's owner, who keeps it). In a team, the team's owner owns it.
   */
  app.post(
    '/applications/:id/team',
    { schema: { params: { type: 'object', properties: { id: ID } }, body: { type: 'object', additionalProperties: false, required: ['teamId'], properties: { teamId: { type: ['string', 'null'], pattern: '^[1-9][0-9]{0,18}$' } } } } },
    async (request, reply) => {
      const viewer = me(request, reply);
      if (!viewer) return;
      const { id } = request.params as { id: string };
      const { teamId } = request.body as { teamId: string | null };
      const [application] = await db.select().from(oauthApps).where(eq(oauthApps.id, id)).limit(1);
      if (!application) return reply.status(404).send({ error: 'Application not found' });
      if (application.teamId) {
        // Out of a team (or into another): only that team's owner.
        if ((await teamRole(db, application.teamId, viewer)) !== 'owner') return reply.status(403).send({ error: 'Only the team’s owner can move its applications', code: 'TEAM_ROLE_TOO_LOW' });
      } else if (application.ownerId !== viewer) {
        return reply.status(404).send({ error: 'Application not found' });
      }
      let ownerId = viewer;
      if (teamId) {
        const role = await teamRole(db, teamId, viewer);
        if (!appRoleAtLeast(role, 'admin')) return reply.status(403).send({ error: 'You need to be an admin of that team', code: 'TEAM_ROLE_TOO_LOW' });
        const [team] = await db.select({ ownerId: devTeams.ownerId }).from(devTeams).where(eq(devTeams.id, teamId)).limit(1);
        ownerId = team.ownerId;
      }
      const [moved] = await db.update(oauthApps).set({ teamId, ownerId }).where(eq(oauthApps.id, id)).returning();
      return reply.send({ application: { id: moved.id, teamId: moved.teamId } });
    }
  );
};
