import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { redactForBot } from '../../lib/bot-redact.js';
import { normalizeRichEmbeds, EmbedError, RICH_EMBEDS_SCHEMA, type RichEmbedInput } from '../../lib/rich-embeds.js';
import {
  eq,
  and,
  lt,
  gt,
  desc,
  asc,
  isNotNull,
  inArray,
  transmissions,
  transmitters,
  transmissionReactions,
  signalBlacklist,
  beaconEmojis,
  beaconStickers,
  relays,
  beaconMembers,
  vaultFiles,
  subspaceMeshMembers,
  resolveRelayAudience,
  resolveMeshAudience,
  type TransmissionPoll,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { resolveVaultAttachments } from '../../lib/attachments.js';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { CHANNEL_TYPES, ChannelType, loadChannel, checkChannelAccess, audienceForChannel } from '../../lib/channels.js';
import { beaconsOf, expressionAllowed, stripForbiddenGlyphs } from '../../lib/glyph-access.js';
import { formatTransmission, deriveChannel } from '../../lib/transmissions.js';
import { parseMentions } from '../../lib/mentions.js';
import { touchChannelLastTransmission, incrementMentionCounts } from '../../lib/read-state.js';
import { channelIsEncrypted } from '../e2ee/e2ee.routes.js';
import { queuePush } from '../../lib/push.js';
import { runAutomod } from '../../lib/automod.js';
import { attachThreads } from '../threads/threads.routes.js';
import { scheduleEmbeds } from '../../lib/embeds.js';

const MAX_TRANSMISSION_LENGTH = 2000;
const MAX_DISTINCT_REACTIONS = 20;
const MAX_PINS = 250;
const TYPING_THROTTLE_SECONDS = 5;

const channelTypeSchema = { type: 'string', enum: CHANNEL_TYPES };

/** Plain words for a push preview: mention tokens and markdown markers removed. */
export function pushText(content: string): string {
  return content
    .replace(/<@&?!?[1-9][0-9]{0,18}>/g, '@someone')
    .replace(/<#[1-9][0-9]{0,18}>/g, '#relay')
    .replace(/<a?:(\w+):[1-9][0-9]{0,18}>/g, ':$1:')
    .replace(/\|\|[\s\S]*?\|\|/g, '[spoiler]')
    .replace(/[*_~`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

/** Room for one envelope per device on both sides (10 + 10) plus the sender's own copy. */
export const MAX_ENCRYPTED_BYTES = 256 * 1024;
/**
 * Ciphertext for an end-to-end encrypted link (see packages/e2ee): an envelope per recipient
 * device, keyed by device id, and the sender's own sealed copy. The server cannot read it.
 */
export const ENCRYPTED_PAYLOAD = {
  type: 'object',
  additionalProperties: false,
  required: ['v', 'senderDevice', 'envelopes'],
  properties: {
    v: { const: 1 },
    senderDevice: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
    envelopes: { type: 'object', maxProperties: 25, additionalProperties: { type: 'object' } },
    self: { type: 'string', maxLength: 65536 },
  },
};

function containerColumn(channelType: string): 'relayId' | 'threadId' | 'p2pLinkId' | 'meshId' {
  switch (channelType) {
    case 'relay':
      return 'relayId';
    case 'thread':
      return 'threadId';
    case 'link':
      return 'p2pLinkId';
    case 'mesh':
      return 'meshId';
    default:
      throw new Error('Unknown channel type');
  }
}

export const messagingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function blockedIdsFor(transmitterId: string): Promise<Set<string>> {
    if (!db) return new Set();
    const blocks = await db
      .select()
      .from(signalBlacklist)
      .where(and(eq(signalBlacklist.transmitterId, transmitterId), eq(signalBlacklist.targetType, 'transmitter')));
    return new Set(blocks.map((b: any) => b.targetId));
  }

  async function loadChannelForExistingTransmission(row: any) {
    const derived = deriveChannel(row);
    if (!derived) return null;
    return loadChannel(db, derived.channelType, derived.channelId);
  }

  /**
   * GET /api/v1/channels/:channelType/:channelId/transmissions
   * Unified paginated history for any container (relay | link | mesh | thread).
   */
  app.get(
    '/channels/:channelType/:channelId/transmissions',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['channelType', 'channelId'],
          properties: { channelType: channelTypeSchema, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            before: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
            after: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
            around: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
            limit: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { channelType, channelId } = request.params as { channelType: string; channelId: string };
      const channel = await loadChannel(db, channelType, channelId);
      if (!channel) return reply.status(404).send({ error: 'Channel not found or not visible' });

      const access = await checkChannelAccess(db, channel, token.transmitterId, 'view');
      if (!access.allowed) return reply.status(access.status).send({ error: access.error, code: access.code });

      const query = request.query as { before?: string; after?: string; around?: string; limit?: string };
      let limit = query.limit ? parseInt(query.limit, 10) : 50;
      if (!Number.isFinite(limit)) limit = 50;
      limit = Math.max(1, Math.min(100, limit));

      const containerFilter = eq((transmissions as any)[containerColumn(channelType)], channelId);

      async function anchorRow(id: string) {
        const [row] = await db.select().from(transmissions).where(eq(transmissions.id, id)).limit(1);
        return row || null;
      }

      let rows: Array<typeof transmissions.$inferSelect> = [];
      if (query.around) {
        const anchor = await anchorRow(query.around);
        if (anchor) {
          const half = Math.max(1, Math.floor(limit / 2));
          const before = await db
            .select()
            .from(transmissions)
            .where(and(containerFilter, lt(transmissions.createdAt, anchor.createdAt)))
            .orderBy(desc(transmissions.createdAt))
            .limit(half);
          const after = await db
            .select()
            .from(transmissions)
            .where(and(containerFilter, gt(transmissions.createdAt, anchor.createdAt)))
            .orderBy(asc(transmissions.createdAt))
            .limit(limit - half);
          rows = [...before.reverse(), anchor, ...after];
        }
      } else if (query.before) {
        const anchor = await anchorRow(query.before);
        if (anchor) {
          rows = await db
            .select()
            .from(transmissions)
            .where(and(containerFilter, lt(transmissions.createdAt, anchor.createdAt)))
            .orderBy(desc(transmissions.createdAt))
            .limit(limit);
          rows = rows.reverse();
        }
      } else if (query.after) {
        const anchor = await anchorRow(query.after);
        if (anchor) {
          rows = await db
            .select()
            .from(transmissions)
            .where(and(containerFilter, gt(transmissions.createdAt, anchor.createdAt)))
            .orderBy(asc(transmissions.createdAt))
            .limit(limit);
        }
      } else {
        rows = await db
          .select()
          .from(transmissions)
          .where(containerFilter)
          .orderBy(desc(transmissions.createdAt))
          .limit(limit);
        rows = rows.reverse();
      }

      const blocked = await blockedIdsFor(token.transmitterId);
      const visible = rows.filter((r) => !blocked.has(r.transmitterId));
      const formatted = await redactForBot(
        db,
        token,
        channel.channelType,
        await Promise.all(visible.map((r) => formatTransmission(db, r, token.transmitterId, { beaconId: channel.beaconId })))
      );

      // Messages that started a thread carry it (the chip under them).
      return reply.send({ transmissions: channel.channelType === 'relay' ? await attachThreads(db, formatted) : formatted });
    }
  );

  /**
   * POST /api/v1/channels/:channelType/:channelId/transmissions
   */
  app.post(
    '/channels/:channelType/:channelId/transmissions',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['channelType', 'channelId'],
          properties: { channelType: channelTypeSchema, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', maxLength: MAX_TRANSMISSION_LENGTH },
            attachmentIds: { type: 'array', items: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, maxItems: 10 },
            stickerIds: { type: 'array', items: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, maxItems: 3 },
            replyToId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
            replyPing: { type: 'boolean' },
            nonce: { type: 'string', maxLength: 100 },
            encrypted: ENCRYPTED_PAYLOAD,
            /** Rich embeds: bots only (people's links get previews instead). */
            embeds: RICH_EMBEDS_SCHEMA,
            poll: {
              type: 'object',
              additionalProperties: false,
              required: ['question', 'answers'],
              properties: {
                question: { type: 'string', minLength: 1, maxLength: 300 },
                answers: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 10,
                  items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 55 }, emoji: { type: 'string', maxLength: 64 } } },
                },
                durationHours: { type: 'integer', enum: [1, 4, 8, 24, 72, 168, 336] },
                allowMultiselect: { type: 'boolean' },
              },
            },
            voiceMessage: {
              type: 'object',
              additionalProperties: false,
              required: ['durationMs'],
              properties: { durationMs: { type: 'integer', minimum: 1, maximum: 20 * 60 * 1000 }, waveform: { type: 'string', maxLength: 400 } },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { channelType, channelId } = request.params as { channelType: string; channelId: string };
      const channel = await loadChannel(db, channelType, channelId);
      if (!channel) return reply.status(404).send({ error: 'Channel not found or not visible' });

      const access = await checkChannelAccess(db, channel, token.transmitterId, 'send');
      if (!access.allowed) return reply.status(access.status).send({ error: access.error, code: access.code });

      const body = request.body as {
        content?: string;
        attachmentIds?: string[];
        stickerIds?: string[];
        replyToId?: string;
        replyPing?: boolean;
        nonce?: string;
        encrypted?: Record<string, unknown>;
        poll?: { question: string; answers: Array<{ text: string; emoji?: string }>; durationHours?: number; allowMultiselect?: boolean };
        voiceMessage?: { durationMs: number; waveform?: string };
        embeds?: RichEmbedInput[];
      };
      let content = (body.content || '').trim();
      const attachmentIds = body.attachmentIds || [];
      // Where glyphs and stickers are checked against: this beacon and the sender's permissions in it.
      const where = { beaconId: channel.beaconId ?? null, perms: access.actorContext?.effectivePermissions ?? null };

      // Encrypted links take ciphertext only; nothing else may carry it.
      const encryptedLink = await channelIsEncrypted(db, channel.channelType, channelId);
      if (encryptedLink && (content || attachmentIds.length || !body.encrypted)) {
        return reply.status(400).send({ error: 'This conversation is end-to-end encrypted; send ciphertext only', code: 'ENCRYPTION_REQUIRED' });
      }
      if (!encryptedLink && body.encrypted) {
        return reply.status(400).send({ error: 'This conversation is not end-to-end encrypted', code: 'NOT_ENCRYPTED' });
      }
      if (body.encrypted && JSON.stringify(body.encrypted).length > MAX_ENCRYPTED_BYTES) {
        return reply.status(413).send({ error: 'Encrypted transmission is too large', code: 'TRANSMISSION_TOO_LARGE' });
      }

      // Slowmode: one transmission per window in this relay, unless they hold Bypass Slowmode.
      if (channel.channelType === 'relay' && access.actorContext && !hasPermission(access.actorContext.effectivePermissions, PERMISSIONS.BYPASS_SLOWMODE)) {
        const [relayRow] = await db.select({ slowmode: relays.slowmodeSeconds }).from(relays).where(eq(relays.id, channelId)).limit(1);
        const redis = (app as any).redis;
        if (relayRow?.slowmode && redis?.status === 'ready') {
          const key = `slowmode:${channelId}:${token.transmitterId}`;
          if ((await redis.set(key, '1', 'EX', relayRow.slowmode, 'NX')) !== 'OK') {
            const left = Math.max(1, await redis.ttl(key));
            return reply.status(429).send({ error: `Slowmode is on: you can send again in ${left}s`, code: 'SLOWMODE', retryAfter: left });
          }
        }
      }

      // Glyphs the sender may not use here become plain :name: text.
      if (content) content = await stripForbiddenGlyphs(db, content, token.transmitterId, where);

      // Stickers come from beacons the sender is in; another beacon's need Use External Stickers.
      let stickers: Array<{ id: string; name: string; url: string }> = [];
      if (body.stickerIds?.length) {
        if (body.encrypted) return reply.status(400).send({ error: 'Stickers cannot be sent in an encrypted conversation' });
        const rows = await db
          .select({ id: beaconStickers.id, name: beaconStickers.name, url: beaconStickers.url, beaconId: beaconStickers.beaconId })
          .from(beaconStickers)
          .innerJoin(beaconMembers, and(eq(beaconMembers.beaconId, beaconStickers.beaconId), eq(beaconMembers.transmitterId, token.transmitterId)))
          .where(inArray(beaconStickers.id, body.stickerIds));
        if (rows.length !== new Set(body.stickerIds).size) return reply.status(400).send({ error: 'Unknown sticker', code: 'INVALID_STICKER' });
        const memberOf = new Set<string>(rows.map((r: any) => r.beaconId));
        if (!rows.every((r: any) => expressionAllowed(r, where, memberOf, 'sticker'))) {
          return reply.status(403).send({ error: 'Stickers from other beacons need Use External Stickers here', code: 'EXTERNAL_STICKER' });
        }
        stickers = body.stickerIds.map((id) => {
          const r = rows.find((x: any) => x.id === id)!;
          return { id: r.id, name: r.name, url: r.url };
        });
      }

      // Polls and voice messages: each its own permission in a beacon, never in an encrypted conversation.
      const inBeacon = channel.channelType === 'relay' || channel.channelType === 'thread';
      const may = (p: bigint) => !inBeacon || (!!access.actorContext && hasPermission(access.actorContext.effectivePermissions, p));
      let poll: TransmissionPoll | null = null;
      if (body.poll) {
        if (body.encrypted) return reply.status(400).send({ error: 'Polls cannot be sent in an encrypted conversation' });
        if (!may(PERMISSIONS.CREATE_POLLS)) return reply.status(403).send({ error: 'Transmitter lacks CREATE_POLLS clearance', code: 'MISSING_PERMISSIONS' });
        poll = {
          question: body.poll.question.trim(),
          answers: body.poll.answers.map((a, i) => ({ id: i + 1, text: a.text.trim(), emoji: a.emoji || null })),
          allowMultiselect: !!body.poll.allowMultiselect,
          expiresAt: new Date(Date.now() + (body.poll.durationHours ?? 24) * 3_600_000).toISOString(),
          endedAt: null,
        };
      }
      if (body.voiceMessage) {
        if (body.encrypted) return reply.status(400).send({ error: 'Voice messages cannot be sent in an encrypted conversation' });
        if (!may(PERMISSIONS.SEND_VOICE_MESSAGES)) return reply.status(403).send({ error: 'Transmitter lacks SEND_VOICE_MESSAGES clearance', code: 'MISSING_PERMISSIONS' });
        if (attachmentIds.length !== 1 || content || stickers.length) return reply.status(400).send({ error: 'A voice message is one audio attachment on its own', code: 'INVALID_VOICE_MESSAGE' });
      }

      let richEmbeds: Array<Record<string, unknown>> = [];
      if (body.embeds?.length) {
        if (!(token as { bot?: boolean }).bot) return reply.status(400).send({ error: 'Only bots and webhooks send embeds', code: 'EMBEDS_BOTS_ONLY' });
        if (body.encrypted) return reply.status(400).send({ error: 'Embeds cannot be sent in an encrypted conversation' });
        if (!may(PERMISSIONS.EMBED_LINKS)) return reply.status(403).send({ error: 'Transmitter lacks EMBED_LINKS clearance', code: 'MISSING_PERMISSIONS' });
        try {
          richEmbeds = normalizeRichEmbeds(body.embeds) as unknown as Array<Record<string, unknown>>;
        } catch (err) {
          if (err instanceof EmbedError) return reply.status(400).send({ error: err.message, code: 'EMBED_TOO_LARGE' });
          throw err;
        }
      }

      if (!content && attachmentIds.length === 0 && !body.encrypted && !stickers.length && !poll && !richEmbeds.length) {
        return reply.status(400).send({ error: 'content, attachmentIds or stickerIds is required' });
      }

      let attachments: Array<{ id: string; url: string; filename: string; size: number; mimeType: string }> = [];
      if (attachmentIds.length > 0) {
        if ((channel.channelType === 'relay' || channel.channelType === 'thread') && !body.voiceMessage) {
          const attachAccess = await checkChannelAccess(db, channel, token.transmitterId, 'attach');
          if (!attachAccess.allowed) return reply.status(attachAccess.status).send({ error: attachAccess.error });
        }
        const resolved = await resolveVaultAttachments(db, token.transmitterId, attachmentIds);
        if (!resolved) {
          return reply.status(400).send({ error: 'One or more attachmentIds are invalid or not owned by the sender', code: 'INVALID_ATTACHMENT' });
        }
        attachments = resolved;
        if (body.voiceMessage) {
          if (!/^audio\//.test(attachments[0].mimeType || '')) return reply.status(400).send({ error: 'A voice message must be audio', code: 'INVALID_VOICE_MESSAGE' });
          attachments = [{ ...attachments[0], durationMs: body.voiceMessage.durationMs, waveform: body.voiceMessage.waveform ?? '' } as any];
        }
      }

      let replyToId: string | null = null;
      let replyPingTarget: string | null = null;
      const replyPing = body.replyPing !== false;
      if (body.replyToId) {
        const [parent] = await db.select().from(transmissions).where(eq(transmissions.id, body.replyToId)).limit(1);
        if (parent) {
          const parentChannel = deriveChannel(parent);
          if (parentChannel && parentChannel.channelType === channelType && parentChannel.channelId === channelId) {
            replyToId = parent.id;
            if (replyPing && parent.transmitterId !== token.transmitterId) replyPingTarget = parent.transmitterId;
          }
        }
      }

      // Determine valid mention targets for this channel.
      const validUserIds = new Set<string>();
      if (channel.channelType === 'relay' || channel.channelType === 'thread') {
        const members = await db.select().from(beaconMembers).where(eq(beaconMembers.beaconId, channel.beaconId!));
        members.forEach((m: any) => validUserIds.add(m.transmitterId));
      } else if (channel.channelType === 'link') {
        (channel.participants || []).forEach((id) => validUserIds.add(id));
      } else if (channel.channelType === 'mesh') {
        const members = await db.select().from(subspaceMeshMembers).where(eq(subspaceMeshMembers.meshId, channelId));
        members.forEach((m: any) => validUserIds.add(m.transmitterId));
      }

      const hasMentionEveryone =
        (channel.channelType === 'relay' || channel.channelType === 'thread') &&
        !!access.actorContext &&
        hasPermission(access.actorContext.effectivePermissions, PERMISSIONS.MENTION_EVERYONE);

      const parsed = await parseMentions(db, content, {
        beaconId: channel.beaconId || null,
        validUserIds,
        authorHasMentionEveryone: hasMentionEveryone,
        authorHasMentionClearances: !!access.actorContext && hasPermission(access.actorContext.effectivePermissions, PERMISSIONS.MENTION_CLEARANCES),
      });
      if (replyPingTarget && !parsed.mentions.includes(replyPingTarget)) {
        parsed.mentions.push(replyPingTarget);
      }

      if ((channel.channelType === 'relay' || channel.channelType === 'thread') && access.actorContext && content) {
        const verdict = await runAutomod(app, db, {
          beaconId: channel.beaconId!,
          relayId: channel.relayId!,
          authorId: token.transmitterId,
          content,
          permissions: access.actorContext.effectivePermissions,
          mentionCount: parsed.mentions.length + parsed.mentionRoles.length + (parsed.mentionEveryone ? 1 : 0),
        });
        if (verdict) return reply.status(403).send({ error: verdict.message, code: 'AUTOMOD_BLOCKED', rule: verdict.ruleName });
      }

      const [inserted] = await db
        .insert(transmissions)
        .values({
          [containerColumn(channelType)]: channelId,
          transmitterId: token.transmitterId,
          content: content || '',
          attachments,
          stickers,
          poll,
          isVoiceMessage: !!body.voiceMessage,
          replyToId,
          replyPing,
          mentions: parsed.mentions,
          mentionRoles: parsed.mentionRoles,
          mentionEveryone: parsed.mentionEveryone,
          type: replyToId ? 'reply' : 'default',
          encryptedPayload: body.encrypted ? JSON.stringify(body.encrypted) : null,
          embeds: richEmbeds,
        })
        .returning();

      await touchChannelLastTransmission(db, channel, inserted.id, inserted.createdAt);

      // Mention-count fan-out for read state.
      let recipientIds: string[] = [];
      if (channel.channelType === 'relay' || channel.channelType === 'thread') {
        recipientIds = await resolveRelayAudience(db, channel.relayId!);
      } else if (channel.channelType === 'link') {
        recipientIds = channel.participants || [];
      } else if (channel.channelType === 'mesh') {
        recipientIds = await resolveMeshAudience(db, channelId);
      }
      const everyMessageCounts = channel.channelType === 'link' || channel.channelType === 'mesh';
      await incrementMentionCounts(
        db,
        channel,
        token.transmitterId,
        recipientIds.map((id) => ({
          recipientId: id,
          isMentionTarget: everyMessageCounts || parsed.mentions.includes(id) || parsed.mentionEveryone,
          isEveryoneOnly: !everyMessageCounts && parsed.mentionEveryone && !parsed.mentions.includes(id),
        }))
      );

      const formatted = await formatTransmission(db, inserted, token.transmitterId, { beaconId: channel.beaconId });

      await publishGatewayEvent(
        app,
        'TRANSMISSION_CREATE',
        { channelType: channel.channelType, channelId, transmission: formatted, nonce: body.nonce },
        audienceForChannel(channel)
      );

      // Mobile push: every message in direct links and meshes, mentions elsewhere.
      const authorName = formatted.author?.displayName || formatted.author?.username || 'Someone';
      const preview = body.encrypted ? 'Sent an encrypted transmission' : pushText(content) || (attachments.length ? 'Sent an attachment' : '');
      if (channel.channelType === 'link' || channel.channelType === 'mesh') {
        queuePush(app, recipientIds.filter((id) => id !== token.transmitterId), { kind: 'message', title: authorName, body: preview, path: `/channels/@me/${channelId}` }, [
          { type: channel.channelType, id: channelId },
        ]);
      } else if (parsed.mentions.length) {
        queuePush(
          app,
          parsed.mentions.filter((id) => id !== token.transmitterId && recipientIds.includes(id)),
          { kind: 'mention', title: `${authorName} mentioned you`, body: preview, path: `/channels/${channel.beaconId}/${channel.relayId}` },
          [{ type: 'relay', id: channel.relayId! }, { type: 'beacon', id: channel.beaconId! }]
        );
      }
      // After the create event, so clients already hold the transmission the previews belong to.
      scheduleEmbeds(app, inserted);

      return reply.status(201).send({ message: 'Transmission dispatched', transmission: formatted });
    }
  );

  /**
   * GET /api/v1/channels/:channelType/:channelId/pins
   */
  app.get(
    '/channels/:channelType/:channelId/pins',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['channelType', 'channelId'],
          properties: { channelType: channelTypeSchema, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { channelType, channelId } = request.params as { channelType: string; channelId: string };
      const channel = await loadChannel(db, channelType, channelId);
      if (!channel) return reply.status(404).send({ error: 'Channel not found or not visible' });

      const access = await checkChannelAccess(db, channel, token.transmitterId, 'view');
      if (!access.allowed) return reply.status(access.status).send({ error: access.error });

      const rows = await db
        .select()
        .from(transmissions)
        .where(and(eq((transmissions as any)[containerColumn(channelType)], channelId), isNotNull(transmissions.pinnedAt)))
        .orderBy(desc(transmissions.pinnedAt));

      const formatted = await redactForBot(db, token, channel.channelType, await Promise.all(rows.map((r: any) => formatTransmission(db, r, token.transmitterId, { beaconId: channel.beaconId }))));
      return reply.send({ transmissions: formatted });
    }
  );

  /**
   * POST /api/v1/channels/:channelType/:channelId/typing
   */
  app.post(
    '/channels/:channelType/:channelId/typing',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['channelType', 'channelId'],
          properties: { channelType: channelTypeSchema, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { channelType, channelId } = request.params as { channelType: string; channelId: string };
      const channel = await loadChannel(db, channelType, channelId);
      if (!channel) return reply.status(404).send({ error: 'Channel not found or not visible' });

      const access = await checkChannelAccess(db, channel, token.transmitterId, 'send');
      if (!access.allowed) return reply.status(access.status).send({ error: access.error });

      const redis = (app as any).redis;
      if (redis) {
        const key = `typing:${channelType}:${channelId}:${token.transmitterId}`;
        const set = await redis.set(key, '1', 'EX', TYPING_THROTTLE_SECONDS, 'NX').catch(() => null);
        if (!set) return reply.status(204).send();
      }

      const [author] = await db.select().from(transmitters).where(eq(transmitters.id, token.transmitterId)).limit(1);
      const audience = audienceForChannel(channel);
      const otherIds =
        'transmitterIds' in audience ? audience.transmitterIds.filter((id) => id !== token.transmitterId) : undefined;

      await publishGatewayEvent(
        app,
        'TYPING_START',
        {
          channelType,
          channelId,
          userId: token.transmitterId,
          displayName: author?.displayName || author?.username || 'Transmitter',
          timestamp: new Date().toISOString(),
        },
        otherIds ? { transmitterIds: otherIds } : audience
      );

      return reply.status(204).send();
    }
  );

  /**
   * PUT/DELETE /api/v1/transmissions/:id/reactions/:emoji/@me
   * DELETE /api/v1/transmissions/:id/reactions/:emoji/:userId
   * GET /api/v1/transmissions/:id/reactions/:emoji
   */
  app.put('/transmissions/:id/reactions/:emoji/@me', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: transmissionId, emoji } = request.params as { id: string; emoji: string };
    const emojiKey = decodeURIComponent(emoji);

    const [existing] = await db.select().from(transmissions).where(eq(transmissions.id, transmissionId)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });

    const channel = await loadChannelForExistingTransmission(existing);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const distinctEmojis = await db
      .select({ emojiKey: transmissionReactions.emojiKey })
      .from(transmissionReactions)
      .where(eq(transmissionReactions.transmissionId, transmissionId));
    const isNewEmoji = !distinctEmojis.some((r: any) => r.emojiKey === emojiKey);

    const access = await checkChannelAccess(db, channel, token.transmitterId, isNewEmoji ? 'react' : 'view');
    if (!access.allowed) return reply.status(access.status).send({ error: access.error });

    if (isNewEmoji && new Set(distinctEmojis.map((r: any) => r.emojiKey)).size >= MAX_DISTINCT_REACTIONS) {
      return reply.status(400).send({ error: `Max ${MAX_DISTINCT_REACTIONS} distinct emojis per transmission`, code: 'REACTION_LIMIT' });
    }

    if (emojiKey.startsWith('custom:')) {
      const glyphId = emojiKey.slice('custom:'.length);
      const [glyph] = await db.select().from(beaconEmojis).where(eq(beaconEmojis.id, glyphId)).limit(1);
      if (!glyph) return reply.status(400).send({ error: 'Unknown glyph', code: 'INVALID_GLYPH' });
      const where = { beaconId: channel.beaconId ?? null, perms: access.actorContext?.effectivePermissions ?? null };
      if (!expressionAllowed(glyph, where, await beaconsOf(db, token.transmitterId), 'glyph')) {
        return reply.status(403).send({ error: glyph.beaconId === channel.beaconId ? 'You cannot use glyphs here' : 'Glyphs from other beacons need Use External Glyphs here', code: 'FOREIGN_GLYPH' });
      }
    }

    await db
      .insert(transmissionReactions)
      .values({ transmissionId, transmitterId: token.transmitterId, emojiKey })
      .onConflictDoNothing();

    await publishGatewayEvent(
      app,
      'REACTION_ADD',
      { channelType: channel.channelType, channelId: channel.channelId, transmissionId, emoji: emojiKey, userId: token.transmitterId },
      audienceForChannel(channel)
    );

    return reply.status(201).send({ message: 'Reaction added' });
  });

  app.delete('/transmissions/:id/reactions/:emoji/@me', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: transmissionId, emoji } = request.params as { id: string; emoji: string };
    const emojiKey = decodeURIComponent(emoji);

    const [existing] = await db.select().from(transmissions).where(eq(transmissions.id, transmissionId)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });
    const channel = await loadChannelForExistingTransmission(existing);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const access = await checkChannelAccess(db, channel, token.transmitterId, 'view');
    if (!access.allowed) return reply.status(access.status).send({ error: access.error });

    await db
      .delete(transmissionReactions)
      .where(
        and(
          eq(transmissionReactions.transmissionId, transmissionId),
          eq(transmissionReactions.transmitterId, token.transmitterId),
          eq(transmissionReactions.emojiKey, emojiKey)
        )
      );

    await publishGatewayEvent(
      app,
      'REACTION_REMOVE',
      { channelType: channel.channelType, channelId: channel.channelId, transmissionId, emoji: emojiKey, userId: token.transmitterId },
      audienceForChannel(channel)
    );

    return reply.send({ message: 'Reaction removed' });
  });

  app.delete('/transmissions/:id/reactions/:emoji/:userId', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: transmissionId, emoji, userId } = request.params as { id: string; emoji: string; userId: string };
    const emojiKey = decodeURIComponent(emoji);

    const [existing] = await db.select().from(transmissions).where(eq(transmissions.id, transmissionId)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });
    const channel = await loadChannelForExistingTransmission(existing);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const access = await checkChannelAccess(db, channel, token.transmitterId, 'manage');
    if (!access.allowed) return reply.status(access.status).send({ error: access.error });

    await db
      .delete(transmissionReactions)
      .where(
        and(
          eq(transmissionReactions.transmissionId, transmissionId),
          eq(transmissionReactions.transmitterId, userId),
          eq(transmissionReactions.emojiKey, emojiKey)
        )
      );

    await publishGatewayEvent(
      app,
      'REACTION_REMOVE',
      { channelType: channel.channelType, channelId: channel.channelId, transmissionId, emoji: emojiKey, userId },
      audienceForChannel(channel)
    );

    return reply.send({ message: 'Reaction removed by moderator' });
  });

  app.get('/transmissions/:id/reactions/:emoji', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: transmissionId, emoji } = request.params as { id: string; emoji: string };
    const emojiKey = decodeURIComponent(emoji);
    const query = request.query as { limit?: string };
    let limit = query.limit ? parseInt(query.limit, 10) : 100;
    if (!Number.isFinite(limit)) limit = 100;
    limit = Math.max(1, Math.min(100, limit));

    const [existing] = await db.select().from(transmissions).where(eq(transmissions.id, transmissionId)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });
    const channel = await loadChannelForExistingTransmission(existing);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const access = await checkChannelAccess(db, channel, token.transmitterId, 'view');
    if (!access.allowed) return reply.status(access.status).send({ error: access.error });

    const rows = await db
      .select({ transmitterId: transmissionReactions.transmitterId })
      .from(transmissionReactions)
      .where(and(eq(transmissionReactions.transmissionId, transmissionId), eq(transmissionReactions.emojiKey, emojiKey)))
      .limit(limit);

    const ids = rows.map((r: any) => r.transmitterId);
    const users = ids.length
      ? await db
          .select({
            id: transmitters.id,
            username: transmitters.username,
            discriminator: transmitters.discriminator,
            displayName: transmitters.displayName,
            avatarUrl: transmitters.avatarUrl,
            displayColor: transmitters.displayColor,
            displayFont: transmitters.displayFont,
          })
          .from(transmitters)
          .where(inArray(transmitters.id, ids))
      : [];

    return reply.send({ users });
  });

  /**
   * PUT/DELETE /api/v1/transmissions/:id/pin
   */
  /**
   * POST /api/v1/transmissions/:id/forward  { targets: [{ channelType, channelId }], comment? }
   * Discord's forwarding: each target gets a snapshot of the transmission (its text,
   * attachments and stickers) and where it came from, with an optional comment.
   * Encrypted conversations are never a source or a target.
   */
  app.post(
    '/transmissions/:id/forward',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['targets'],
          properties: {
            targets: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['channelType', 'channelId'],
                properties: { channelType: channelTypeSchema, channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
              },
            },
            comment: { type: 'string', maxLength: MAX_TRANSMISSION_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { id } = request.params as { id: string };
      const body = request.body as { targets: Array<{ channelType: string; channelId: string }>; comment?: string };

      const [original] = await db.select().from(transmissions).where(eq(transmissions.id, id)).limit(1);
      if (!original) return reply.status(404).send({ error: 'Transmission not found' });
      const source = await loadChannelForExistingTransmission(original);
      if (!source) return reply.status(404).send({ error: 'Transmission not found' });
      const view = await checkChannelAccess(db, source, token.transmitterId, 'view');
      if (!view.allowed) return reply.status(404).send({ error: 'Transmission not found' });
      if (original.encryptedPayload) return reply.status(400).send({ error: 'Encrypted transmissions cannot be forwarded', code: 'ENCRYPTED' });
      if (original.type !== 'default' && original.type !== 'reply') return reply.status(400).send({ error: 'Only transmissions can be forwarded' });

      let sourceName: string | null = null;
      if (source.relayId) {
        const [relay] = await db.select({ name: relays.name }).from(relays).where(eq(relays.id, source.relayId)).limit(1);
        sourceName = relay?.name ?? null;
      }
      const snapshot = {
        content: original.forwarded ? original.forwarded.content : original.content,
        attachments: original.forwarded ? original.forwarded.attachments : original.attachments ?? [],
        stickers: original.forwarded ? original.forwarded.stickers ?? [] : (original as any).stickers ?? [],
        createdAt: new Date(original.createdAt).toISOString(),
        source: { channelType: source.channelType, channelId: source.channelId, beaconId: source.beaconId ?? null, name: sourceName, transmissionId: original.id },
      };

      const sent: any[] = [];
      for (const target of body.targets) {
        const channel = await loadChannel(db, target.channelType, target.channelId);
        if (!channel) return reply.status(404).send({ error: 'Target not found' });
        const access = await checkChannelAccess(db, channel, token.transmitterId, 'send');
        if (!access.allowed) return reply.status(access.status).send({ error: access.error, code: access.code });
        if (await channelIsEncrypted(db, channel.channelType, channel.channelId)) {
          return reply.status(400).send({ error: 'Encrypted conversations cannot receive forwards', code: 'ENCRYPTED' });
        }
        const [row] = await db
          .insert(transmissions)
          .values({ [containerColumn(channel.channelType)]: channel.channelId, transmitterId: token.transmitterId, content: (body.comment ?? '').trim(), forwarded: snapshot })
          .returning();
        await touchChannelLastTransmission(db, channel, row.id, row.createdAt);
        const formatted = await formatTransmission(db, row, token.transmitterId, { beaconId: channel.beaconId });
        await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType: channel.channelType, channelId: channel.channelId, transmission: formatted }, audienceForChannel(channel));
        sent.push(formatted);
      }
      return reply.status(201).send({ transmissions: sent });
    }
  );

  app.put('/transmissions/:id/pin', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: transmissionId } = request.params as { id: string };
    const [existing] = await db.select().from(transmissions).where(eq(transmissions.id, transmissionId)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });
    const channel = await loadChannelForExistingTransmission(existing);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const access = await checkChannelAccess(db, channel, token.transmitterId, 'pin');
    if (!access.allowed) return reply.status(access.status).send({ error: access.error });

    if (existing.pinnedAt) return reply.status(200).send({ message: 'Already pinned' });

    const currentPins = await db
      .select({ id: transmissions.id })
      .from(transmissions)
      .where(and(eq((transmissions as any)[containerColumn(channel.channelType)], channel.channelId), isNotNull(transmissions.pinnedAt)));
    if (currentPins.length >= MAX_PINS) {
      return reply.status(400).send({ error: `Cannot exceed ${MAX_PINS} pins per channel`, code: 'PIN_LIMIT' });
    }

    const now = new Date();
    const [updated] = await db
      .update(transmissions)
      .set({ pinnedAt: now, pinnedBy: token.transmitterId })
      .where(eq(transmissions.id, transmissionId))
      .returning();

    const [systemMsg] = await db
      .insert(transmissions)
      .values({
        [containerColumn(channel.channelType)]: channel.channelId,
        transmitterId: token.transmitterId,
        content: 'pinned a transmission',
        type: 'system_pin',
      })
      .returning();

    const formatted = await formatTransmission(db, updated, token.transmitterId, { beaconId: channel.beaconId });
    const audience = audienceForChannel(channel);
    await publishGatewayEvent(app, 'TRANSMISSION_UPDATE', { channelType: channel.channelType, channelId: channel.channelId, transmission: formatted }, audience);
    await publishGatewayEvent(
      app,
      'CHANNEL_PINS_UPDATE',
      { channelType: channel.channelType, channelId: channel.channelId, lastPinAt: now.toISOString() },
      audience
    );
    const formattedSystem = await formatTransmission(db, systemMsg, token.transmitterId, { beaconId: channel.beaconId });
    await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType: channel.channelType, channelId: channel.channelId, transmission: formattedSystem }, audience);

    return reply.send({ message: 'Transmission pinned', transmission: formatted });
  });

  app.delete('/transmissions/:id/pin', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: transmissionId } = request.params as { id: string };
    const [existing] = await db.select().from(transmissions).where(eq(transmissions.id, transmissionId)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });
    const channel = await loadChannelForExistingTransmission(existing);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    const access = await checkChannelAccess(db, channel, token.transmitterId, 'pin');
    if (!access.allowed) return reply.status(access.status).send({ error: access.error });

    const [updated] = await db
      .update(transmissions)
      .set({ pinnedAt: null, pinnedBy: null })
      .where(eq(transmissions.id, transmissionId))
      .returning();

    const formatted = await formatTransmission(db, updated, token.transmitterId, { beaconId: channel.beaconId });
    const audience = audienceForChannel(channel);
    await publishGatewayEvent(app, 'TRANSMISSION_UPDATE', { channelType: channel.channelType, channelId: channel.channelId, transmission: formatted }, audience);
    await publishGatewayEvent(
      app,
      'CHANNEL_PINS_UPDATE',
      { channelType: channel.channelType, channelId: channel.channelId, lastPinAt: new Date().toISOString() },
      audience
    );

    return reply.send({ message: 'Transmission unpinned', transmission: formatted });
  });
};
