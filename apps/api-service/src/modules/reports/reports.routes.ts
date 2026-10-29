import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, gt, inArray, lt, incidentReports, transmissions, transmitters, beacons } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { checkChannelAccess, loadChannel } from '../../lib/channels.js';
import { deriveChannel } from '../../lib/transmissions.js';
import { COMMITMENT_PATTERN, opensCommitment, storedCommitment, type RevealedAttachment } from '../../lib/franking.js';

const SNOWFLAKE = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const KEY_B64 = { type: 'string', pattern: COMMITMENT_PATTERN };
/** Transmissions shared on each side of a reported encrypted one. */
export const REPORT_CONTEXT = 5;

/** What a reporter reveals of one encrypted transmission: its decrypted contents and franking key. */
interface Reveal {
  id: string;
  text: string;
  attachments?: RevealedAttachment[];
  /** Absent for a transmission sent before franking. */
  fk?: string;
}

const REVEAL = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text'],
  properties: {
    id: SNOWFLAKE,
    text: { type: 'string', maxLength: 8000 },
    attachments: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'key', 'filename', 'mimeType', 'size'],
        properties: {
          url: { type: 'string', maxLength: 1000 },
          key: KEY_B64,
          filename: { type: 'string', maxLength: 255 },
          mimeType: { type: 'string', maxLength: 255 },
          size: { type: 'integer', minimum: 0 },
        },
      },
    },
    fk: KEY_B64,
  },
};

/** How a transmission in an encrypted report's context came to staff. */
type ContextStatus = 'verified' | 'unverified' | 'not-shared';

export const reportRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/reports
   * Submit an Incident Flare report against a Transmission, Transmitter, or Beacon.
   *
   * A transmission must be one the reporter can see. In an end-to-end encrypted conversation the
   * server cannot read it, so the reporter's client reveals it, with the transmissions around it,
   * in plain text (after warning them): `reveals` holds each one's contents and franking key. The
   * server picks the context itself (REPORT_CONTEXT on each side, in that conversation) and checks
   * every reveal against the commitment its sender stored, so a reporter cannot put words in
   * anyone's mouth. A reveal that does not open its commitment refuses the whole report.
   */
  app.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['targetType', 'targetId', 'reason'],
          properties: {
            targetType: { type: 'string', enum: ['transmission', 'transmitter', 'beacon'] },
            targetId: SNOWFLAKE,
            reason: { type: 'string', enum: ['harassment', 'spam', 'malware', 'illicit_content', 'other'] },
            description: { type: 'string', maxLength: 1000 },
            reveals: { type: 'array', maxItems: 2 * REPORT_CONTEXT + 1, items: REVEAL },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { targetType, targetId, reason, description, reveals } = request.body as {
        targetType: 'transmission' | 'transmitter' | 'beacon';
        targetId: string;
        reason: string;
        description?: string;
        reveals?: Reveal[];
      };
      if (reveals && targetType !== 'transmission') return reply.status(400).send({ error: 'Only a transmission is reported with its contents', code: 'NOT_ENCRYPTED' });

      // Telemetry capture
      const telemetrySnapshot: Record<string, any> = {
        clientIp: request.ip,
        userAgent: request.headers['user-agent'] || 'Unknown Client',
        timestamp: new Date().toISOString(),
      };

      if (targetType === 'transmission') {
        const [msg] = await db.select().from(transmissions).where(eq(transmissions.id, targetId)).limit(1);
        // Only what the reporter can see: otherwise reporting a guessed id would copy a private
        // conversation into the report for staff.
        const derived = msg ? deriveChannel(msg) : null;
        const channel = derived ? await loadChannel(db, derived.channelType, derived.channelId) : null;
        const visible = channel ? (await checkChannelAccess(db, channel, token.transmitterId, 'view')).allowed : false;
        if (!msg || !channel || !visible) return reply.status(404).send({ error: 'Transmission not found' });

        telemetrySnapshot.transmissionAuthorId = msg.transmitterId;
        telemetrySnapshot.channelType = channel.channelType;
        telemetrySnapshot.channelId = channel.channelId;
        if (channel.beaconId) telemetrySnapshot.beaconId = channel.beaconId;
        if (msg.relayId) telemetrySnapshot.relayId = msg.relayId;

        if (msg.encryptedPayload) {
          const context = await encryptedContext(msg, channel.channelType, channel.channelId, reveals ?? []);
          if ('error' in context) return reply.status(400).send(context);
          telemetrySnapshot.encrypted = true;
          telemetrySnapshot.encryptedContext = context.items;
          telemetrySnapshot.transmissionContent = (context.items.find((i) => i.target) as { text?: string } | undefined)?.text ?? null;
        } else {
          if (reveals) return reply.status(400).send({ error: 'This transmission is not end-to-end encrypted', code: 'NOT_ENCRYPTED' });
          telemetrySnapshot.transmissionContent = msg.content;
          telemetrySnapshot.attachmentsCount = msg.attachments ? msg.attachments.length : 0;
        }
      } else if (targetType === 'transmitter') {
        const [usr] = await db.select({ id: transmitters.id, username: transmitters.username }).from(transmitters).where(eq(transmitters.id, targetId)).limit(1);
        if (!usr) return reply.status(404).send({ error: 'Transmitter not found' });
        telemetrySnapshot.targetUsername = usr.username;
      } else {
        const [b] = await db.select({ id: beacons.id, name: beacons.name, ownerId: beacons.ownerId }).from(beacons).where(eq(beacons.id, targetId)).limit(1);
        if (!b) return reply.status(404).send({ error: 'Beacon not found' });
        telemetrySnapshot.beaconName = b.name;
        telemetrySnapshot.beaconOwnerId = b.ownerId;
        telemetrySnapshot.beaconId = b.id;
      }

      const [report] = await db
        .insert(incidentReports)
        .values({
          reporterId: token.transmitterId,
          targetType,
          targetId,
          reason,
          description: description ? description.trim() || null : null,
          telemetrySnapshot,
          status: 'open',
        })
        .returning();

      return reply.status(201).send({
        message: 'Incident Flare submitted to Command Staff',
        report,
      });
    }
  );

  /**
   * The reported encrypted transmission and REPORT_CONTEXT on each side of it, each with what the
   * reporter revealed and whether it opened the sender's commitment. Transmissions sent before
   * franking existed have no commitment: their contents are kept but marked unverified.
   */
  async function encryptedContext(msg: any, channelType: string, channelId: string, reveals: Reveal[]) {
    const column = channelType === 'link' ? transmissions.p2pLinkId : channelType === 'mesh' ? transmissions.meshId : null;
    if (!column) return { error: 'Only direct links and group DMs are encrypted', code: 'NOT_ENCRYPTED' };
    const inConversation = eq(column, channelId);
    // By id (snowflakes are unique and time-ordered): two sent in the same millisecond both count.
    const before = await db.select().from(transmissions).where(and(inConversation, lt(transmissions.id, msg.id))).orderBy(desc(transmissions.id)).limit(REPORT_CONTEXT);
    const after = await db.select().from(transmissions).where(and(inConversation, gt(transmissions.id, msg.id))).orderBy(asc(transmissions.id)).limit(REPORT_CONTEXT);
    const rows = [...before.reverse(), msg, ...after];
    const byId = new Map(rows.map((r: any) => [r.id, r]));

    const seen = new Set<string>();
    for (const r of reveals) {
      if (seen.has(r.id)) return { error: 'A transmission was revealed twice', code: 'DUPLICATE_REVEAL' };
      seen.add(r.id);
      // Only the transmissions the server chose: a reporter cannot add others, from here or elsewhere.
      if (!byId.has(r.id)) return { error: 'A revealed transmission is not next to the reported one', code: 'REVEAL_OUT_OF_CONTEXT' };
    }
    if (!seen.has(msg.id)) return { error: 'Reveal the reported transmission to report it', code: 'REVEAL_REQUIRED' };

    const revealed = new Map(reveals.map((r) => [r.id, r]));
    const authors = await db.select({ id: transmitters.id, username: transmitters.username, displayName: transmitters.displayName }).from(transmitters).where(inArray(transmitters.id, [...new Set(rows.map((r: any) => r.transmitterId))]));
    const nameOf = new Map(authors.map((a: any) => [a.id, a.displayName || a.username]));
    const items = [];
    for (const row of rows as any[]) {
      const reveal = revealed.get(row.id);
      const commitment = storedCommitment(row.encryptedPayload);
      let status: ContextStatus = 'not-shared';
      if (reveal) {
        if (!row.encryptedPayload) return { error: 'A revealed transmission is not encrypted', code: 'NOT_ENCRYPTED' };
        if (commitment) {
          if (!reveal.fk || !opensCommitment(commitment, reveal.fk, reveal.text, reveal.attachments ?? [])) {
            return { error: 'A revealed transmission does not match what was sent', code: 'REVEAL_MISMATCH' };
          }
          status = 'verified';
        } else status = 'unverified';
      }
      items.push({
        id: row.id,
        authorId: row.transmitterId,
        authorName: nameOf.get(row.transmitterId) ?? null,
        createdAt: row.createdAt,
        edited: !!row.isEdited,
        target: row.id === msg.id,
        status,
        // What the server already stores in the clear, for a transmission sent before encryption.
        ...(reveal ? { text: reveal.text, attachments: reveal.attachments ?? [] } : row.encryptedPayload ? {} : { text: row.content, plain: true }),
      });
    }
    return { items };
  }
};
