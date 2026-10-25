import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  desc,
  relays,
  transmissions,
  transmitters,
  signalBlacklist,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import {
  extractAuthToken,
  resolveBeaconActorContext,
  resolveRelayActorContext,
  assertCanModerateTarget,
} from '../../middleware/hierarchy.js';
import { publishGatewayEvent, audienceForTransmission } from '../../lib/events.js';
import { loadChannel } from '../../lib/channels.js';
import { parseMentions } from '../../lib/mentions.js';
import { touchChannelLastTransmission } from '../../lib/read-state.js';
import { beaconMembers as beaconMembersTable, subspaceMeshMembers as subspaceMeshMembersTable } from '@subspace/database';

import { resolveVaultAttachments } from '../../lib/attachments.js';
import { runAutomod } from '../../lib/automod.js';
import { scheduleEmbeds } from '../../lib/embeds.js';
import { MAX_ENCRYPTED_BYTES } from '../messaging/messaging.routes.js';
const MAX_TRANSMISSION_LENGTH = 2000;

export const transmissionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/relays/:relayId/transmissions
   * Post a transmission to a text relay.
   * Invariants:
   * 1. 2000-char maximum length.
   * 2. Member must have completed onboarding.
   * 3. Requires SEND_TRANSMISSIONS permission.
   */
  app.post('/relays/:relayId/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { relayId } = request.params as { relayId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!targetRelay) {
      return reply.status(404).send({ error: 'Relay not found' });
    }

    const actorContext = await resolveRelayActorContext(db, token.transmitterId, targetRelay);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!actorContext.isOwner && !actorContext.member.hasCompletedOnboarding) {
      return reply.status(403).send({
        error: 'Must complete Beacon onboarding rules agreement before transmitting',
        code: 'ONBOARDING_REQUIRED',
      });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.SEND_TRANSMISSIONS)) {
      return reply.status(403).send({ error: 'Transmitter lacks SEND_TRANSMISSIONS clearance' });
    }

    const body = request.body as any;
    const { content, attachmentIds } = body || {};
    const attachments = await resolveVaultAttachments(db, token.transmitterId, attachmentIds);
    if (!attachments) {
      return reply.status(400).send({ error: 'Invalid attachmentIds', code: 'INVALID_ATTACHMENT' });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Transmission content cannot be empty' });
    }

    if (content.length > MAX_TRANSMISSION_LENGTH) {
      return reply.status(400).send({
        error: `Transmission exceeds maximum allowed length of ${MAX_TRANSMISSION_LENGTH} characters`,
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
        length: content.length,
        maxLength: MAX_TRANSMISSION_LENGTH,
      });
    }

    const verdict = await runAutomod(app, db, {
      beaconId: targetRelay.beaconId,
      relayId,
      authorId: token.transmitterId,
      content: content.trim(),
      permissions: actorContext.effectivePermissions,
      mentionCount: content.match(/<@[!&]?[0-9a-f-]{36}>/g)?.length ?? 0,
    });
    if (verdict) return reply.status(403).send({ error: verdict.message, code: 'AUTOMOD_BLOCKED', rule: verdict.ruleName });

    const [newTransmission] = await db
      .insert(transmissions)
      .values({
        relayId,
        transmitterId: token.transmitterId,
        content: content.trim(),
        attachments,
      })
      .returning();
    // Keep the relay's unread marker current, as the unified send route does.
    await touchChannelLastTransmission(db, { channelType: 'relay', channelId: relayId }, newTransmission.id, newTransmission.createdAt);
    scheduleEmbeds(app, newTransmission);

    const [authorProfile] = await db
      .select({
        id: transmitters.id,
        username: transmitters.username,
        discriminator: transmitters.discriminator,
        displayName: transmitters.displayName,
        displayColor: transmitters.displayColor,
        avatarUrl: transmitters.avatarUrl,
        staffRank: transmitters.staffRank,
      })
      .from(transmitters)
      .where(eq(transmitters.id, token.transmitterId))
      .limit(1);

    const formatted = {
      ...newTransmission,
      author: authorProfile || null,
      authorName: authorProfile?.displayName || authorProfile?.username || 'Transmitter',
      authorUsername: authorProfile?.username || 'transmitter',
      authorAvatar: authorProfile?.avatarUrl || null,
    };

    await publishGatewayEvent(
      app,
      'TRANSMISSION_CREATE',
      { relay_id: relayId, beacon_id: targetRelay.beaconId, transmission: formatted },
      { relayId }
    );

    return reply.status(201).send({
      message: 'Transmission dispatched',
      transmission: formatted,
    });
  });

  /**
   * GET /api/v1/relays/:relayId/transmissions
   * Fetch paginated transmissions for a relay, filtering out transmitters blocked by the caller
   */
  app.get('/relays/:relayId/transmissions', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { relayId } = request.params as { relayId: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!targetRelay) return reply.status(404).send({ error: 'Relay not found' });

    const actorContext = await resolveRelayActorContext(db, token.transmitterId, targetRelay);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
      return reply.status(403).send({ error: 'Transmitter lacks VIEW_RELAY clearance' });
    }

    // Get blocked transmitters
    const blocks = await db
      .select()
      .from(signalBlacklist)
      .where(
        and(
          eq(signalBlacklist.transmitterId, token.transmitterId),
          eq(signalBlacklist.targetType, 'transmitter')
        )
      );
    const blockedIds = new Set(blocks.map((b: any) => b.targetId));

    const messages = await db
      .select({
        id: transmissions.id,
        relayId: transmissions.relayId,
        transmitterId: transmissions.transmitterId,
        content: transmissions.content,
        attachments: transmissions.attachments,
        isEdited: transmissions.isEdited,
        createdAt: transmissions.createdAt,
        updatedAt: transmissions.updatedAt,
        authorId: transmitters.id,
        authorUsername: transmitters.username,
        authorDiscriminator: transmitters.discriminator,
        authorDisplayName: transmitters.displayName,
        authorDisplayColor: transmitters.displayColor,
        authorAvatar: transmitters.avatarUrl,
        authorStaffRank: transmitters.staffRank,
      })
      .from(transmissions)
      .innerJoin(transmitters, eq(transmissions.transmitterId, transmitters.id))
      .where(eq(transmissions.relayId, relayId))
      .orderBy(desc(transmissions.createdAt))
      .limit(50);

    const filtered = messages
      .filter((m: any) => !blockedIds.has(m.transmitterId))
      .map((m: any) => ({
        id: m.id,
        relayId: m.relayId,
        transmitterId: m.transmitterId,
        authorId: m.authorId,
        content: m.content,
        attachments: m.attachments,
        isEdited: m.isEdited,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        authorName: m.authorDisplayName,
        authorUsername: m.authorUsername,
        authorAvatar: m.authorAvatar,
        author: {
          id: m.authorId,
          username: m.authorUsername,
          discriminator: m.authorDiscriminator,
          displayName: m.authorDisplayName,
          displayColor: m.authorDisplayColor,
          avatarUrl: m.authorAvatar,
          staffRank: m.authorStaffRank,
        },
      }))
      // Return chronologically (oldest to newest) for client message feed
      .reverse();

    return reply.send({ transmissions: filtered });
  });

  /**
   * PATCH /api/v1/transmissions/:id
   * Edit a transmission (author only)
   */
  app.patch('/transmissions/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: transmissionId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [existing] = await db
      .select()
      .from(transmissions)
      .where(eq(transmissions.id, transmissionId))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });

    if (existing.transmitterId !== token.transmitterId) {
      return reply.status(403).send({ error: 'Only the original transmitter can modify this signal' });
    }

    const body = request.body as any;
    const { content } = body || {};

    // Encrypted transmissions are edited by replacing their ciphertext.
    if (existing.encryptedPayload) {
      const encrypted = body?.encrypted;
      if (!encrypted || typeof encrypted !== 'object' || encrypted.v !== 1 || typeof encrypted.envelopes !== 'object' || content) {
        return reply.status(400).send({ error: 'This conversation is end-to-end encrypted; send ciphertext only', code: 'ENCRYPTION_REQUIRED' });
      }
      if (JSON.stringify(encrypted).length > MAX_ENCRYPTED_BYTES) return reply.status(413).send({ error: 'Encrypted transmission is too large' });
      const [updated] = await db
        .update(transmissions)
        .set({ encryptedPayload: JSON.stringify(encrypted), isEdited: true, updatedAt: new Date() })
        .where(eq(transmissions.id, transmissionId))
        .returning();
      await publishGatewayEvent(app, 'TRANSMISSION_UPDATE', { link_id: existing.p2pLinkId, transmission: { ...updated, encrypted } }, await audienceForTransmission(db, existing));
      return reply.send({ message: 'Transmission updated', transmission: { ...updated, encrypted } });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.status(400).send({ error: 'Content cannot be empty' });
    }

    if (content.length > MAX_TRANSMISSION_LENGTH) {
      return reply.status(400).send({
        error: `Transmission exceeds maximum allowed length of ${MAX_TRANSMISSION_LENGTH} characters`,
        code: 'TRANSMISSION_EXCEEDS_LENGTH',
      });
    }

    const channel = await loadChannel(
      db,
      existing.threadId ? 'thread' : existing.relayId ? 'relay' : existing.p2pLinkId ? 'link' : 'mesh',
      existing.threadId || existing.relayId || existing.p2pLinkId || existing.meshId
    );

    const validUserIds = new Set<string>();
    if (channel?.channelType === 'relay' || channel?.channelType === 'thread') {
      const members = await db.select().from(beaconMembersTable).where(eq(beaconMembersTable.beaconId, channel.beaconId!));
      members.forEach((m: any) => validUserIds.add(m.transmitterId));
    } else if (channel?.channelType === 'link') {
      (channel.participants || []).forEach((id) => validUserIds.add(id));
    } else if (channel?.channelType === 'mesh') {
      const members = await db.select().from(subspaceMeshMembersTable).where(eq(subspaceMeshMembersTable.meshId, channel.channelId));
      members.forEach((m: any) => validUserIds.add(m.transmitterId));
    }

    let mentionEveryoneAllowed = false;
    let editorPerms: bigint | null = null;
    if (channel?.beaconId) {
      const actorCtx = channel.relayId
        ? await resolveRelayActorContext(db, existing.transmitterId, { id: channel.relayId, beaconId: channel.beaconId })
        : await resolveBeaconActorContext(db, existing.transmitterId, channel.beaconId);
      mentionEveryoneAllowed = !!actorCtx && hasPermission(actorCtx.effectivePermissions, PERMISSIONS.MENTION_EVERYONE);
      editorPerms = actorCtx?.effectivePermissions ?? null;
    }

    const parsed = await parseMentions(db, content.trim(), {
      beaconId: channel?.beaconId || null,
      validUserIds,
      authorHasMentionEveryone: mentionEveryoneAllowed,
    });

    // AutoMod checks edits too, as on Discord.
    if (channel?.beaconId && channel.relayId && editorPerms !== null) {
      const verdict = await runAutomod(app, db, {
        beaconId: channel.beaconId,
        relayId: channel.relayId,
        authorId: existing.transmitterId,
        content: content.trim(),
        permissions: editorPerms,
        mentionCount: parsed.mentions.length + parsed.mentionRoles.length,
      });
      if (verdict) return reply.status(403).send({ error: verdict.message, code: 'AUTOMOD_BLOCKED', rule: verdict.ruleName });
    }

    const [updated] = await db
      .update(transmissions)
      .set({
        content: content.trim(),
        isEdited: true,
        updatedAt: new Date(),
        mentions: parsed.mentions,
        mentionRoles: parsed.mentionRoles,
        mentionEveryone: parsed.mentionEveryone,
      })
      .where(eq(transmissions.id, transmissionId))
      .returning();
    if (updated.content !== existing.content) scheduleEmbeds(app, updated);

    await publishGatewayEvent(
      app,
      'TRANSMISSION_UPDATE',
      { relay_id: existing.relayId, transmission: updated },
      await audienceForTransmission(db, existing)
    );

    return reply.send({
      message: 'Transmission updated',
      transmission: updated,
    });
  });

  /**
   * DELETE /api/v1/transmissions/:id
   * Delete a transmission (author, or moderator with MANAGE_TRANSMISSIONS following hierarchy)
   */
  app.delete('/transmissions/:id', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });

    const { id: transmissionId } = request.params as { id: string };
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const [existing] = await db
      .select()
      .from(transmissions)
      .where(eq(transmissions.id, transmissionId))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: 'Transmission not found' });

    // Author can always delete their own transmission
    if (existing.transmitterId === token.transmitterId) {
      const audience = await audienceForTransmission(db, existing);
      await db.delete(transmissions).where(eq(transmissions.id, transmissionId));
      await publishGatewayEvent(
        app,
        'TRANSMISSION_DELETE',
        { relay_id: existing.relayId, transmissionId },
        audience
      );
      return reply.send({ message: 'Transmission erased' });
    }

    // Otherwise must be in a Beacon Relay and have MANAGE_TRANSMISSIONS + hierarchy authority
    if (!existing.relayId) {
      return reply.status(403).send({ error: 'Cannot delete other transmitters direct messages' });
    }

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, existing.relayId))
      .limit(1);

    if (!targetRelay) return reply.status(404).send({ error: 'Relay not found' });

    const actorContext = await resolveRelayActorContext(db, token.transmitterId, targetRelay);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    if (!hasPermission(actorContext.effectivePermissions, PERMISSIONS.MANAGE_TRANSMISSIONS)) {
      return reply.status(403).send({ error: 'Transmitter lacks MANAGE_TRANSMISSIONS clearance' });
    }

    const canModerate = await assertCanModerateTarget(db, actorContext, existing.transmitterId, reply);
    if (!canModerate) return;

    await db.delete(transmissions).where(eq(transmissions.id, transmissionId));
    await publishGatewayEvent(
      app,
      'TRANSMISSION_DELETE',
      { relay_id: existing.relayId, transmissionId },
      { relayId: existing.relayId }
    );

    return reply.send({ message: 'Transmission erased by clearance moderator' });
  });
};
