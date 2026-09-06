import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, incidentReports, transmissions, transmitters, beacons } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';

export const reportRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/reports
   * Submit an Incident Flare report against a Transmission, Transmitter, or Beacon
   */
  app.post('/', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const body = request.body as any;
    const { targetType, targetId, reason, description } = body || {};

    const validTypes = ['transmission', 'transmitter', 'beacon'];
    if (!targetType || !validTypes.includes(targetType)) {
      return reply.status(400).send({
        error: `Invalid targetType. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    if (!targetId || typeof targetId !== 'string') {
      return reply.status(400).send({ error: 'targetId is required' });
    }

    const validReasons = ['harassment', 'spam', 'malware', 'illicit_content', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return reply.status(400).send({
        error: `Invalid reason. Must be one of: ${validReasons.join(', ')}`,
      });
    }

    // Telemetry capture
    const telemetrySnapshot: Record<string, any> = {
      clientIp: request.ip,
      userAgent: request.headers['user-agent'] || 'Unknown Client',
      timestamp: new Date().toISOString(),
    };

    if (targetType === 'transmission') {
      const [msg] = await db
        .select()
        .from(transmissions)
        .where(eq(transmissions.id, targetId))
        .limit(1);

      if (msg) {
        telemetrySnapshot.transmissionContent = msg.content;
        telemetrySnapshot.transmissionAuthorId = msg.transmitterId;
        telemetrySnapshot.relayId = msg.relayId;
        telemetrySnapshot.attachmentsCount = msg.attachments ? msg.attachments.length : 0;
      }
    } else if (targetType === 'transmitter') {
      const [usr] = await db
        .select({ id: transmitters.id, username: transmitters.username })
        .from(transmitters)
        .where(eq(transmitters.id, targetId))
        .limit(1);

      if (usr) {
        telemetrySnapshot.targetUsername = usr.username;
      }
    } else if (targetType === 'beacon') {
      const [b] = await db
        .select({ id: beacons.id, name: beacons.name, ownerId: beacons.ownerId })
        .from(beacons)
        .where(eq(beacons.id, targetId))
        .limit(1);

      if (b) {
        telemetrySnapshot.beaconName = b.name;
        telemetrySnapshot.beaconOwnerId = b.ownerId;
      }
    }

    const [report] = await db
      .insert(incidentReports)
      .values({
        reporterId: token.transmitterId,
        targetType,
        targetId,
        reason,
        description: description ? String(description).trim() : null,
        telemetrySnapshot,
        status: 'open',
      })
      .returning();

    return reply.status(201).send({
      message: 'Incident Flare submitted to Command Staff',
      report,
    });
  });
};
