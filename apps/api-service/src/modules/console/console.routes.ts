import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  desc,
  asc,
  ilike,
  incidentReports,
  transmitters,
  beacons,
  vaultFiles,
} from '@subspace/database';
import { STAFF_RANKS } from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';

export const consoleRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * Middleware helper: verify staff rank
   */
  async function requireStaffRank(request: any, reply: any, minRank: number) {
    const token = extractAuthToken(request);
    if (!token) {
      reply.status(401).send({ error: 'Authentication required' });
      return null;
    }

    if (!db) {
      reply.status(503).send({ error: 'Database service unavailable' });
      return null;
    }

    const [staffMember] = await db
      .select()
      .from(transmitters)
      .where(eq(transmitters.id, token.transmitterId))
      .limit(1);

    if (!staffMember || staffMember.staffRank < minRank) {
      reply.status(403).send({
        error: 'Transmitter lacks necessary Command Staff clearance rank',
        code: 'INSUFFICIENT_STAFF_RANK',
        currentRank: staffMember?.staffRank || 0,
        requiredRank: minRank,
      });
      return null;
    }

    return { token, staffMember };
  }

  /**
   * GET /api/v1/console/reports
   * List incident reports (staffRank >= MODERATOR)
   */
  app.get('/reports', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.MODERATOR);
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
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.MODERATOR);
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
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.MODERATOR);
    if (!auth) return;

    const query = request.query as any;
    const search = query.search ? `%${query.search}%` : null;

    let q = db
      .select({
        id: transmitters.id,
        username: transmitters.username,
        displayName: transmitters.displayName,
        email: transmitters.email,
        staffRank: transmitters.staffRank,
        isBanned: transmitters.isBanned,
        banReason: transmitters.banReason,
        createdAt: transmitters.createdAt,
      })
      .from(transmitters)
      .orderBy(desc(transmitters.createdAt))
      .limit(50);

    if (search) {
      q = q.where(ilike(transmitters.username, search));
    }

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
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.ADMIN);
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

    // INVARIANT: Cannot ban someone of equal or higher staff rank
    if (target.staffRank >= auth.staffMember.staffRank) {
      return reply.status(403).send({
        error: 'Cannot moderate or suspend staff member with equal or higher rank',
        code: 'FORBIDDEN_STAFF_HIERARCHY',
        actorRank: auth.staffMember.staffRank,
        targetRank: target.staffRank,
      });
    }

    const [bannedUser] = await db
      .update(transmitters)
      .set({
        isBanned: true,
        banReason: reason ? String(reason).trim() : 'Violation of Subspace Directives',
        updatedAt: new Date(),
      })
      .where(eq(transmitters.id, targetId))
      .returning();

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
  app.post('/transmitters/:id/unban', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.ADMIN);
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

    if (target.staffRank >= auth.staffMember.staffRank) {
      return reply.status(403).send({
        error: 'Cannot modify staff member with equal or higher rank',
        code: 'FORBIDDEN_STAFF_HIERARCHY',
      });
    }

    const [unbannedUser] = await db
      .update(transmitters)
      .set({
        isBanned: false,
        banReason: null,
        updatedAt: new Date(),
      })
      .where(eq(transmitters.id, targetId))
      .returning();

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
   * PATCH /api/v1/console/transmitters/:id/staff-rank
   * Promote or demote staff rank (staffRank === ROOT only)
   */
  app.patch('/transmitters/:id/staff-rank', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.ROOT);
    if (!auth) return;

    const { id: targetId } = request.params as { id: string };
    const body = request.body as any;
    const newRank = Number(body?.staffRank);

    if (![0, 1, 2, 3].includes(newRank)) {
      return reply.status(400).send({
        error: 'Invalid staffRank. Must be 0 (NONE), 1 (MODERATOR), 2 (ADMIN), or 3 (ROOT)',
      });
    }

    const [updated] = await db
      .update(transmitters)
      .set({ staffRank: newRank, updatedAt: new Date() })
      .where(eq(transmitters.id, targetId))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'Target transmitter not found' });
    }

    return reply.send({
      message: 'Staff rank updated',
      transmitter: {
        id: updated.id,
        username: updated.username,
        staffRank: updated.staffRank,
      },
    });
  });

  /**
   * GET /api/v1/console/vault/files
   * Audit files uploaded to Subspace Vault across all transmitters (staffRank >= MODERATOR)
   */
  app.get('/vault/files', async (request, reply) => {
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.MODERATOR);
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
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.MODERATOR);
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
    const auth = await requireStaffRank(request, reply, STAFF_RANKS.ADMIN);
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

    return reply.send({
      message: 'Beacon discovery status updated by Command Staff',
      beacon: {
        id: updated.id,
        name: updated.name,
        isDiscoverable: updated.isDiscoverable,
      },
    });
  });
};
