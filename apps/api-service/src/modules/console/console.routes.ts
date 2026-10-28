import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  desc,
  asc,
  ilike,
  isNull,
  and,
  or,
  sql,
  incidentReports,
  transmitters,
  beacons,
  vaultFiles,
  storageGroups,
  defaultStorageLimits,
  staffRoles,
  assignStaffRole,
  oauthApps,
  appActivities,
  isNotNull,
  appBots,
  loadDeveloperPolicy,
  saveDeveloperPolicy,
} from '@subspace/database';
import { PRIVILEGED_INTENTS, STAFF_RANKS, VERIFICATION_METHODS, isDetectedGame, normalizeDeveloperPolicy, type StaffPermission } from '@subspace/constants';
import { publishSessionRefresh } from '../../lib/events.js';
import { revokeSessions } from '../../lib/sessions.js';
import { outranks, requireStaff, staffAudit, who } from '../../lib/staff.js';

export const consoleRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  const requireStaffRank = (request: any, reply: any, permission?: StaffPermission) => requireStaff(db, request, reply, permission);

  /**
   * GET /api/v1/console/reports
   * List incident reports (staffRank >= MODERATOR)
   */
  app.get('/reports', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'VIEW_REPORTS');
    if (!auth) return;

    const query = request.query as any;
    const statusFilter = query.status ? String(query.status) : null;
    const targetTypeFilter = query.targetType ? String(query.targetType) : null;

    let q = db
      .select({
        report: incidentReports,
        reporter: {
          id: transmitters.id,
          username: transmitters.username,
          displayName: transmitters.displayName,
        },
      })
      .from(incidentReports)
      .innerJoin(transmitters, eq(incidentReports.reporterId, transmitters.id))
      .orderBy(desc(incidentReports.createdAt));

    if (statusFilter) {
      q = q.where(eq(incidentReports.status, statusFilter));
    }
    if (targetTypeFilter) {
      q = q.where(eq(incidentReports.targetType, targetTypeFilter));
    }

    const reports = await q;

    return reply.send({
      count: reports.length,
      reports,
    });
  });

  /**
   * PATCH /api/v1/console/reports/:id
   * Resolve or dismiss an incident report (staffRank >= MODERATOR)
   */
  app.patch('/reports/:id', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'VIEW_REPORTS');
    if (!auth) return;

    const { id: reportId } = request.params as { id: string };
    const body = request.body as any;
    const { status, resolutionNotes } = body || {};

    const validStatuses = ['investigating', 'resolved', 'dismissed'];
    if (!status || !validStatuses.includes(status)) {
      return reply.status(400).send({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const [updated] = await db
      .update(incidentReports)
      .set({
        status,
        resolutionNotes: resolutionNotes || null,
        resolvedByStaffId: auth.staffMember.id,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(incidentReports.id, reportId))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'Incident report not found' });
    }
    await staffAudit(db, auth, { action: `report.${status}`, targetType: 'report', targetId: reportId, summary: `Marked a ${updated.reason} report ${status}` });

    return reply.send({
      message: 'Incident report status updated',
      report: updated,
    });
  });

  /**
   * GET /api/v1/console/transmitters
   * Search / list instance transmitters (staffRank >= MODERATOR)
   */
  app.get('/transmitters', async (request, reply) => {
    const auth = await requireStaffRank(request, reply);
    if (!auth) return;

    const query = request.query as any;
    // Matches anywhere in the username or display name; % and _ in the search are literal.
    const search = typeof query.search === 'string' && query.search.trim() ? `%${query.search.trim().replace(/[\\%_]/g, (c: string) => `\\${c}`)}%` : null;

    let q = db
      .select({
        id: transmitters.id,
        username: transmitters.username,
        discriminator: transmitters.discriminator,
        displayName: transmitters.displayName,
        avatarUrl: transmitters.avatarUrl,
        email: transmitters.email,
        staffRank: transmitters.staffRank,
        staffRoleId: transmitters.staffRoleId,
        botKind: transmitters.botKind,
        isBanned: transmitters.isBanned,
        banReason: transmitters.banReason,
        quarantinedAt: transmitters.quarantinedAt,
        quarantineReason: transmitters.quarantineReason,
        storageGroupId: transmitters.storageGroupId,
        isEmailVerified: transmitters.isEmailVerified,
        phoneVerifiedAt: transmitters.phoneVerifiedAt,
        handVerifiedAt: transmitters.handVerifiedAt,
        createdAt: transmitters.createdAt,
      })
      .from(transmitters)
      .orderBy(desc(transmitters.createdAt))
      .limit(50);

    // Deleted accounts are anonymized husks ("Deleted User"): nothing for staff to act on.
    q = q.where(and(isNull(transmitters.deletedAt), search ? or(ilike(transmitters.username, search), ilike(transmitters.displayName, search)) : undefined));

    const list = await q;

    return reply.send({
      count: list.length,
      transmitters: list,
    });
  });

  /**
   * POST /api/v1/console/transmitters/:id/ban
   * Suspend/ban a transmitter (staffRank >= ADMIN, hierarchy strictly enforced)
   */
  app.post('/transmitters/:id/ban', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'SUSPEND');
    if (!auth) return;

    const { id: targetId } = request.params as { id: string };
    const body = request.body as any;
    const { reason } = body || {};

    const [target] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.id, targetId))
      .limit(1);

    if (!target) {
      return reply.status(404).send({ error: 'Target transmitter not found' });
    }

    // INVARIANT: nobody acts on an account at or above their own staff rank.
    if (!(await outranks(db, auth, target, reply))) return;

    const [bannedUser] = await db
      .update(transmitters)
      .set({
        isBanned: true,
        banReason: reason ? String(reason).trim() : 'Violation of Subspace Directives',
        updatedAt: new Date(),
      })
      .where(eq(transmitters.id, targetId))
      .returning();
    // Out everywhere at once: every device session ends and open sockets close.
    await revokeSessions(app, targetId);
    await staffAudit(db, auth, { action: 'transmitter.suspend', targetType: 'transmitter', targetId, summary: `Suspended ${who(target)}`, details: { reason: bannedUser.banReason } });

    return reply.send({
      message: 'Transmitter suspended from instance',
      transmitter: {
        id: bannedUser.id,
        username: bannedUser.username,
        isBanned: bannedUser.isBanned,
        banReason: bannedUser.banReason,
      },
    });
  });

  /**
   * POST /api/v1/console/transmitters/:id/unban
   * Lift suspension on a transmitter (staffRank >= ADMIN, hierarchy enforced)
   */
  /**
   * POST /api/v1/console/transmitters/:id/quarantine   { reason }
   * POST /api/v1/console/transmitters/:id/unquarantine
   * Quarantine: the account keeps reading, but cannot post or react in beacons, DM anyone
   * new or join beacons. Shown to beacon moderators as a member signal.
   */
  const setQuarantine = (on: boolean) => async (request: any, reply: any) => {
    const auth = await requireStaffRank(request, reply, 'QUARANTINE');
    if (!auth) return;
    const { id: targetId } = request.params as { id: string };
    const [target] = await db.select().from(transmitters).where(eq(transmitters.id, targetId)).limit(1);
    if (!target) return reply.status(404).send({ error: 'Target transmitter not found' });
    if (!(await outranks(db, auth, target, reply))) return;
    const reason = on ? String((request.body as any)?.reason ?? '').trim().slice(0, 500) || 'Flagged by Subspace staff' : null;
    const [row] = await db
      .update(transmitters)
      .set({ quarantinedAt: on ? new Date() : null, quarantineReason: reason, updatedAt: new Date() })
      .where(eq(transmitters.id, targetId))
      .returning();
    await staffAudit(db, auth, { action: on ? 'transmitter.quarantine' : 'transmitter.unquarantine', targetType: 'transmitter', targetId, summary: `${on ? 'Quarantined' : 'Lifted the quarantine on'} ${who(target)}`, details: on ? { reason } : undefined });
    return reply.send({ transmitter: { id: row.id, username: row.username, quarantinedAt: row.quarantinedAt, quarantineReason: row.quarantineReason } });
  };
  app.post('/transmitters/:id/quarantine', setQuarantine(true));
  app.post('/transmitters/:id/unquarantine', setQuarantine(false));

  app.post('/transmitters/:id/unban', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'SUSPEND');
    if (!auth) return;

    const { id: targetId } = request.params as { id: string };

    const [target] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.id, targetId))
      .limit(1);

    if (!target) {
      return reply.status(404).send({ error: 'Target transmitter not found' });
    }

    if (!(await outranks(db, auth, target, reply))) return;

    const [unbannedUser] = await db
      .update(transmitters)
      .set({
        isBanned: false,
        banReason: null,
        updatedAt: new Date(),
      })
      .where(eq(transmitters.id, targetId))
      .returning();
    await staffAudit(db, auth, { action: 'transmitter.unsuspend', targetType: 'transmitter', targetId, summary: `Lifted the suspension on ${who(target)}` });

    return reply.send({
      message: 'Transmitter suspension lifted',
      transmitter: {
        id: unbannedUser.id,
        username: unbannedUser.username,
        isBanned: unbannedUser.isBanned,
      },
    });
  });

  /**
   * PATCH /api/v1/console/transmitters/:id/staff-rank  { staffRank: 0-3 }
   * The original fixed ranks, kept for older clients: 1-3 put the account in the built-in
   * Moderator, Admin or Root rank, 0 takes it out of staff. Root only; the console now uses
   * PATCH /transmitters/:id/staff-role.
   */
  app.patch('/transmitters/:id/staff-rank', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_STAFF');
    if (!auth) return;
    if (!auth.role.isRoot) return reply.status(403).send({ error: 'Only Root can use fixed ranks', code: 'INSUFFICIENT_STAFF_RANK' });

    const { id: targetId } = request.params as { id: string };
    const newRank = Number((request.body as any)?.staffRank);
    if (![0, 1, 2, 3].includes(newRank)) {
      return reply.status(400).send({ error: 'Invalid staffRank. Must be 0 (NONE), 1 (MODERATOR), 2 (ADMIN), or 3 (ROOT)' });
    }
    // The instance must keep a root: nobody demotes themselves out of it here.
    if (targetId === auth.token.transmitterId && newRank < STAFF_RANKS.ROOT) {
      return reply.status(400).send({ error: 'You cannot lower your own rank', code: 'SELF_DEMOTION' });
    }
    const [target] = await db.select().from(transmitters).where(eq(transmitters.id, targetId)).limit(1);
    if (!target) return reply.status(404).send({ error: 'Target transmitter not found' });
    const [role] = newRank ? await db.select().from(staffRoles).where(eq(staffRoles.legacyRank, newRank)).limit(1) : [null];
    if (newRank && !role) return reply.status(404).send({ error: 'That built-in rank was deleted', code: 'STAFF_ROLE_NOT_FOUND' });
    const updated = await assignStaffRole(db, targetId, role);
    await staffAudit(db, auth, { action: 'staff.assign', targetType: 'transmitter', targetId, summary: role ? `Gave ${who(target)} the ${role.name} rank` : `Removed ${who(target)} from staff` });

    return reply.send({
      message: 'Staff rank updated',
      transmitter: { id: updated.id, username: updated.username, staffRank: updated.staffRank, staffRoleId: updated.staffRoleId },
    });
  });

  /**
   * GET /api/v1/console/vault/files
   * Audit files uploaded to Subspace Vault across all transmitters (staffRank >= MODERATOR)
   */
  app.get('/vault/files', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_VAULT');
    if (!auth) return;

    const files = (
      await db
        .select({
          file: vaultFiles,
          uploader: {
            id: transmitters.id,
            username: transmitters.username,
          },
        })
        .from(vaultFiles)
        .innerJoin(transmitters, eq(vaultFiles.transmitterId, transmitters.id))
        .orderBy(desc(vaultFiles.createdAt))
        .limit(50)
    ).map((item: any) => ({
      ...item,
      file: {
        ...item.file,
        sizeBytes: item.file.sizeBytes ? item.file.sizeBytes.toString() : '0',
      },
    }));

    return reply.send({
      count: files.length,
      files,
    });
  });

  /**
   * PATCH /api/v1/console/vault/files/:id/quarantine
   * Toggle quarantine on a vault file (staffRank >= MODERATOR)
   */
  app.patch('/vault/files/:id/quarantine', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_VAULT');
    if (!auth) return;

    const { id: fileId } = request.params as { id: string };
    const body = request.body as any;
    const isQuarantined = Boolean(body?.isQuarantined);

    const [updated] = await db
      .update(vaultFiles)
      .set({ isQuarantined })
      .where(eq(vaultFiles.id, fileId))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'Vault file not found' });
    }
    await staffAudit(db, auth, { action: isQuarantined ? 'vault.quarantine' : 'vault.release', targetType: 'vault_file', targetId: fileId, summary: `${isQuarantined ? 'Quarantined' : 'Released'} the file ${updated.filename ?? fileId}` });

    return reply.send({
      message: isQuarantined ? 'File quarantined' : 'File quarantine lifted',
      file: {
        ...updated,
        sizeBytes: updated.sizeBytes ? updated.sizeBytes.toString() : '0',
      },
    });
  });

  /**
   * PATCH /api/v1/console/beacons/:id/discovery
   * Force-moderate Beacon discovery visibility (staffRank >= ADMIN)
   */
  app.patch('/beacons/:id/discovery', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_DISCOVERY');
    if (!auth) return;

    const { id: beaconId } = request.params as { id: string };
    const body = request.body as any;
    const isDiscoverable = Boolean(body?.isDiscoverable);

    const [updated] = await db
      .update(beacons)
      .set({ isDiscoverable, updatedAt: new Date() })
      .where(eq(beacons.id, beaconId))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'Beacon not found' });
    }
    await staffAudit(db, auth, { action: isDiscoverable ? 'beacon.discovery_on' : 'beacon.discovery_off', targetType: 'beacon', targetId: beaconId, summary: `${isDiscoverable ? 'Listed' : 'Took'} ${updated.name} ${isDiscoverable ? 'in' : 'out of'} Discovery` });

    return reply.send({
      message: 'Beacon discovery status updated by Command Staff',
      beacon: {
        id: updated.id,
        name: updated.name,
        isDiscoverable: updated.isDiscoverable,
      },
    });
  });

  // ---- Developers ------------------------------------------------------------------------------
  // Who may create applications and turn on privileged bot intents (see DeveloperPolicy), and
  // accounts staff verified by hand. Connected bots pick up a change straight away.

  /** The bots whose intents a change can affect: every bot with one on, or just this developer's. */
  const botsWithIntents = async (ownerId?: string) => {
    const rows = await db
      .select({ userId: appBots.userId })
      .from(appBots)
      .innerJoin(oauthApps, eq(oauthApps.id, appBots.appId))
      .where(and(or(eq(appBots.messageContent, true), eq(appBots.activityIntent, true)), ownerId ? eq(oauthApps.ownerId, ownerId) : undefined));
    return rows.map((r: { userId: string }) => r.userId);
  };

  /** GET /api/v1/console/developer-policy */
  app.get('/developer-policy', async (request, reply) => {
    if (!(await requireStaffRank(request, reply, 'MANAGE_DEVELOPERS'))) return;
    return reply.send({ policy: await loadDeveloperPolicy(db) });
  });

  /** PUT /api/v1/console/developer-policy  DeveloperPolicy */
  app.put(
    '/developer-policy',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['verifiedBy', 'createApps', 'createAppsRequires', 'intents'],
          properties: {
            verifiedBy: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: [...VERIFICATION_METHODS] } },
            createApps: { type: 'string', enum: ['everyone', 'verified'] },
            createAppsRequires: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['email', 'phone'] } },
            intents: {
              type: 'object',
              additionalProperties: false,
              required: [...PRIVILEGED_INTENTS],
              properties: Object.fromEntries(PRIVILEGED_INTENTS.map((i) => [i, { type: 'string', enum: ['everyone', 'verified'] }])),
            },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = await requireStaffRank(request, reply, 'MANAGE_DEVELOPERS');
      if (!auth) return;
      const policy = normalizeDeveloperPolicy(request.body);
      await saveDeveloperPolicy(db, policy);
      await staffAudit(db, auth, { action: 'developers.policy', targetType: 'instance', summary: 'Changed the developer policy', details: policy as unknown as Record<string, unknown> });
      await publishSessionRefresh(app, await botsWithIntents());
      return reply.send({ policy });
    }
  );

  /** PATCH /api/v1/console/transmitters/:id/verified  { verified } — verified by hand. */
  app.patch(
    '/transmitters/:id/verified',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } },
        body: { type: 'object', additionalProperties: false, required: ['verified'], properties: { verified: { type: 'boolean' } } },
      },
    },
    async (request, reply) => {
      const auth = await requireStaffRank(request, reply, 'MANAGE_DEVELOPERS');
      if (!auth) return;
      const { id } = request.params as { id: string };
      const { verified } = request.body as { verified: boolean };
      const [target] = await db.select().from(transmitters).where(and(eq(transmitters.id, id), isNull(transmitters.deletedAt))).limit(1);
      if (!target) return reply.status(404).send({ error: 'Target transmitter not found' });
      // People (for the developer policy) and bots (the check on their APP tag, against impersonation).
      if (target.botKind && target.botKind !== 'bot') return reply.status(400).send({ error: 'Webhooks cannot be verified', code: 'NOT_VERIFIABLE' });
      const [updated] = await db
        .update(transmitters)
        .set({ handVerifiedAt: verified ? (target.handVerifiedAt ?? new Date()) : null })
        .where(eq(transmitters.id, id))
        .returning({ id: transmitters.id, handVerifiedAt: transmitters.handVerifiedAt });
      if (!!target.handVerifiedAt !== verified) {
        const what = target.botKind === 'bot' ? `the bot ${who(target)}` : who(target);
        await staffAudit(db, auth, { action: verified ? 'transmitter.verify' : 'transmitter.unverify', targetType: 'transmitter', targetId: id, summary: `${verified ? 'Verified' : 'Removed verification from'} ${what}` });
        await publishSessionRefresh(app, await botsWithIntents(id));
      }
      return reply.send({ transmitter: updated });
    }
  );

  // ---- Verified games --------------------------------------------------------------------------
  // A developer's application linked to a game the desktop app detects: its icon then replaces the
  // game's Steam cover in activity status. Staff verify it, so nobody can restyle someone else's game.

  const verifiedGames = () =>
    db
      .select({ game: oauthApps.detectedGame, id: oauthApps.id, name: oauthApps.name, iconUrl: oauthApps.iconUrl, owner: transmitters.username })
      .from(oauthApps)
      .innerJoin(transmitters, eq(transmitters.id, oauthApps.ownerId))
      .where(isNotNull(oauthApps.detectedGame))
      .orderBy(asc(oauthApps.detectedGame));

  /** GET /api/v1/console/verified-games */
  app.get('/verified-games', async (request, reply) => {
    if (!(await requireStaffRank(request, reply, 'MANAGE_DEVELOPERS'))) return;
    const rows = await verifiedGames();
    return reply.send({ games: rows.map(({ game, ...application }: any) => ({ game, application })) });
  });

  /** PUT /api/v1/console/verified-games { game, applicationId }: replaces any app verified for it before. */
  app.put(
    '/verified-games',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['game', 'applicationId'],
          properties: { game: { type: 'string', minLength: 1, maxLength: 128 }, applicationId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
      },
    },
    async (request, reply) => {
      const auth = await requireStaffRank(request, reply, 'MANAGE_DEVELOPERS');
      if (!auth) return;
      const { game, applicationId } = request.body as { game: string; applicationId: string };
      if (!isDetectedGame(game)) return reply.status(400).send({ error: 'That is not a game the desktop app detects', code: 'UNKNOWN_GAME' });
      const [target] = await db.select({ id: oauthApps.id, name: oauthApps.name }).from(oauthApps).where(eq(oauthApps.id, applicationId)).limit(1);
      if (!target) return reply.status(404).send({ error: 'Unknown application', code: 'UNKNOWN_APPLICATION' });
      await db.transaction(async (tx: any) => {
        await tx.update(oauthApps).set({ detectedGame: null }).where(or(eq(oauthApps.detectedGame, game), eq(oauthApps.id, applicationId)));
        await tx.update(oauthApps).set({ detectedGame: game }).where(eq(oauthApps.id, applicationId));
      });
      await staffAudit(db, auth, { action: 'game.verify', targetType: 'application', targetId: applicationId, summary: `Verified ${target.name} as ${game}` });
      const rows = await verifiedGames();
      return reply.send({ games: rows.map(({ game, ...application }: any) => ({ game, application })) });
    }
  );

  /** DELETE /api/v1/console/verified-games?game=... */
  app.delete('/verified-games', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_DEVELOPERS');
    if (!auth) return;
    const game = String((request.query as { game?: string }).game ?? '');
    const [was] = await db.update(oauthApps).set({ detectedGame: null }).where(eq(oauthApps.detectedGame, game)).returning({ id: oauthApps.id, name: oauthApps.name });
    if (!was) return reply.status(404).send({ error: 'No application is verified for that game' });
    await staffAudit(db, auth, { action: 'game.unverify', targetType: 'application', targetId: was.id, summary: `Removed ${was.name} as ${game}` });
    return reply.status(204).send();
  });

  // ---- Activities (MANAGE_DEVELOPERS) -----------------------------------------
  // Custom Activities run third-party pages in comm-links. Until staff approve one, only its
  // application's team can launch it; a new URL takes the approval away (app-activities.routes.ts).

  const listActivities = async () => {
    const rows = await db
      .select({ act: appActivities, app: { id: oauthApps.id, name: oauthApps.name, iconUrl: oauthApps.iconUrl }, owner: transmitters.username })
      .from(appActivities)
      .innerJoin(oauthApps, eq(oauthApps.id, appActivities.appId))
      .innerJoin(transmitters, eq(transmitters.id, oauthApps.ownerId))
      .orderBy(desc(appActivities.updatedAt))
      .limit(500);
    return rows.map((r: any) => ({
      application: { ...r.app, owner: r.owner },
      name: r.act.name,
      description: r.act.description,
      url: r.act.url,
      maxParticipants: r.act.maxParticipants,
      approved: !!r.act.approvedAt,
      approvedAt: r.act.approvedAt,
      updatedAt: r.act.updatedAt,
    }));
  };

  /** GET /api/v1/console/activities: every registered Activity, newest change first. */
  app.get('/activities', async (request, reply) => {
    if (!(await requireStaffRank(request, reply, 'MANAGE_DEVELOPERS'))) return;
    return reply.send({ activities: await listActivities() });
  });

  /** PUT|DELETE /api/v1/console/activities/:appId/approval: let everyone launch it, or only its team again. */
  for (const method of ['put', 'delete'] as const) {
    app[method]('/activities/:appId/approval', async (request, reply) => {
      const auth = await requireStaffRank(request, reply, 'MANAGE_DEVELOPERS');
      if (!auth) return;
      const { appId } = request.params as { appId: string };
      if (!/^[1-9][0-9]{0,18}$/.test(appId)) return reply.status(404).send({ error: 'Unknown activity' });
      const approve = method === 'put';
      const [row] = await db
        .update(appActivities)
        .set(approve ? { approvedAt: new Date(), approvedBy: auth.token.transmitterId } : { approvedAt: null, approvedBy: null })
        .where(eq(appActivities.appId, appId))
        .returning();
      if (!row) return reply.status(404).send({ error: 'Unknown activity' });
      await staffAudit(db, auth, {
        action: approve ? 'activity.approve' : 'activity.unapprove',
        targetType: 'application',
        targetId: appId,
        summary: `${approve ? 'Approved' : 'Withdrew approval of'} the activity ${row.name} (${row.url})`,
      });
      return reply.send({ activities: await listActivities() });
    });
  }

  // ---- Storage groups (staffRank >= ADMIN) ----------------------------------
  // Accounts in a group get its Vault quota and upload limit instead of the defaults.

  const MB = 1024 * 1024;
  const groupBody = {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      quotaMb: { type: 'integer', minimum: 1, maximum: 10_000_000 },
      maxUploadMb: { type: 'integer', minimum: 1, maximum: 100_000 },
    },
  };
  const serializeGroup = (g: any, members = 0) => ({ id: g.id, name: g.name, quotaMb: Math.round(Number(g.quotaBytes) / MB), maxUploadMb: Math.round(Number(g.maxUploadBytes) / MB), members, createdAt: g.createdAt });

  app.get('/storage-groups', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_STORAGE');
    if (!auth) return;
    const groups = await db.select().from(storageGroups).orderBy(asc(storageGroups.name));
    const counts = await db.select({ id: transmitters.storageGroupId, n: sql<number>`count(*)::int` }).from(transmitters).groupBy(transmitters.storageGroupId);
    const byId = new Map(counts.map((c: any) => [c.id, c.n]));
    const d = defaultStorageLimits();
    return reply.send({
      defaults: { quotaMb: Math.round(d.quotaBytes / MB), maxUploadMb: Math.round(d.maxUploadBytes / MB) },
      groups: groups.map((g: any) => serializeGroup(g, Number(byId.get(g.id) ?? 0))),
    });
  });

  app.post('/storage-groups', { schema: { body: { ...groupBody, required: ['name', 'quotaMb', 'maxUploadMb'] } } }, async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_STORAGE');
    if (!auth) return;
    const b = request.body as { name: string; quotaMb: number; maxUploadMb: number };
    try {
      const [g] = await db.insert(storageGroups).values({ name: b.name.trim(), quotaBytes: b.quotaMb * MB, maxUploadBytes: b.maxUploadMb * MB }).returning();
      await staffAudit(db, auth, { action: 'storage_group.create', targetType: 'storage_group', targetId: g.id, summary: `Created the storage group ${g.name}`, details: { quotaMb: b.quotaMb, maxUploadMb: b.maxUploadMb } });
      return reply.status(201).send({ group: serializeGroup(g) });
    } catch {
      return reply.status(409).send({ error: 'A storage group with that name already exists', code: 'GROUP_NAME_TAKEN' });
    }
  });

  app.patch('/storage-groups/:id', { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } }, body: groupBody } }, async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_STORAGE');
    if (!auth) return;
    const b = request.body as { name?: string; quotaMb?: number; maxUploadMb?: number };
    const set: any = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name.trim();
    if (b.quotaMb !== undefined) set.quotaBytes = b.quotaMb * MB;
    if (b.maxUploadMb !== undefined) set.maxUploadBytes = b.maxUploadMb * MB;
    try {
      const [g] = await db.update(storageGroups).set(set).where(eq(storageGroups.id, (request.params as any).id)).returning();
      if (!g) return reply.status(404).send({ error: 'Storage group not found' });
      await staffAudit(db, auth, { action: 'storage_group.update', targetType: 'storage_group', targetId: g.id, summary: `Changed the storage group ${g.name}`, details: b });
      return reply.send({ group: serializeGroup(g) });
    } catch {
      return reply.status(409).send({ error: 'A storage group with that name already exists', code: 'GROUP_NAME_TAKEN' });
    }
  });

  app.delete('/storage-groups/:id', { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } } } }, async (request, reply) => {
    const auth = await requireStaffRank(request, reply, 'MANAGE_STORAGE');
    if (!auth) return;
    // Members fall back to the instance defaults (on delete set null).
    const [g] = await db.delete(storageGroups).where(eq(storageGroups.id, (request.params as any).id)).returning();
    if (!g) return reply.status(404).send({ error: 'Storage group not found' });
    await staffAudit(db, auth, { action: 'storage_group.delete', targetType: 'storage_group', targetId: g.id, summary: `Deleted the storage group ${g.name}` });
    return reply.send({ deleted: true });
  });

  app.patch(
    '/transmitters/:id/storage-group',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } },
        body: { type: 'object', additionalProperties: false, required: ['groupId'], properties: { groupId: { anyOf: [{ type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, { type: 'null' }] } } },
      },
    },
    async (request, reply) => {
      const auth = await requireStaffRank(request, reply, 'MANAGE_STORAGE');
      if (!auth) return;
      const { groupId } = request.body as { groupId: string | null };
      if (groupId) {
        const [g] = await db.select({ id: storageGroups.id }).from(storageGroups).where(eq(storageGroups.id, groupId)).limit(1);
        if (!g) return reply.status(404).send({ error: 'Storage group not found' });
      }
      const [u] = await db
        .update(transmitters)
        .set({ storageGroupId: groupId, updatedAt: new Date() })
        .where(eq(transmitters.id, (request.params as any).id))
        .returning({ id: transmitters.id, username: transmitters.username, storageGroupId: transmitters.storageGroupId });
      if (!u) return reply.status(404).send({ error: 'Target transmitter not found' });
      await staffAudit(db, auth, { action: 'transmitter.storage_group', targetType: 'transmitter', targetId: u.id, summary: groupId ? `Moved ${u.username} to a storage group` : `Moved ${u.username} back to default storage`, details: { groupId } });
      return reply.send({ transmitter: u });
    }
  );
};
