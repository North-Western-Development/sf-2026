import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  sql,
  or,
  inArray,
  transmitters,
  beaconMembers,
  clearances,
  beacons,
  affiliations,
  signalBlacklist,
  transmitterNotes,
  transmitterCommendations,
  commendations,
  resolveTransmitterBeaconIds,
  highestPerFamily,
  accountConnections,
  appBots,
  appCommands,
  oauthApps,
  isNull,
} from '@subspace/database';
import {
  isValidUsername,
  HEX_COLOR_REGEX,
  DISPLAY_NAME_STYLE_FONTS,
  DISPLAY_NAME_STYLE_EFFECTS,
  PROFILE_VISIBILITY_LEVELS,
  AVATAR_DECORATIONS,
  PROFILE_EFFECTS,
  ACTIVITY_VISIBILITY,
  appRoleAtLeast,
} from '@subspace/constants';
import { appRole } from '../../lib/app-access.js';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';
import { validateMediaUrl } from '../../lib/media.js';
import { serializePublicTransmitter, serializeTransmitter } from '../../lib/serialize.js';
import { confirmPassword } from '../../lib/confirm-password.js';
import { refreshCommendations } from '../../lib/commendations.js';

const MAX_BIO_LENGTH = 190;
const MAX_PRONOUNS_LENGTH = 40;
const MAX_CUSTOM_STATUS_LENGTH = 128;
/** Longest private note about someone (NOTE_MAX_LENGTH, default 1024 characters). */
const MAX_NOTE_LENGTH = Math.max(1, Math.floor(Number(process.env.NOTE_MAX_LENGTH)) || 1024);

/** Allocates a fresh discriminator for a username change; kept local to avoid a circular import. */
async function allocateDiscriminator(db: any, username: string): Promise<string | null> {
  const takenUsers = await db
    .select({ discriminator: transmitters.discriminator })
    .from(transmitters)
    .where(eq(transmitters.username, username));
  const takenSet = new Set(takenUsers.map((u: any) => u.discriminator));
  if (takenSet.size >= 9999) return null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = (Math.floor(Math.random() * 9999) + 1).toString().padStart(4, '0');
    if (!takenSet.has(candidate)) return candidate;
  }
  return null;
}

function isValidDisplayNameStyle(style: any): boolean {
  if (style === null) return true;
  if (typeof style !== 'object') return false;
  if (style.font !== undefined && !DISPLAY_NAME_STYLE_FONTS.includes(style.font)) return false;
  if (style.effect !== undefined && !DISPLAY_NAME_STYLE_EFFECTS.includes(style.effect)) return false;
  if (style.colors !== undefined) {
    if (!Array.isArray(style.colors) || style.colors.length < 1 || style.colors.length > 2) return false;
    if (!style.colors.every((c: any) => typeof c === 'string' && HEX_COLOR_REGEX.test(c))) return false;
  }
  return true;
}

export interface ProfileUpdateResult {
  status: number;
  body: any;
}

/**
 * Shared handler backing both `PATCH /users/@me/profile` (canonical) and
 * `PATCH /auth/me/profile` (legacy alias). Every field is validated server-side.
 */
export async function applyProfileUpdate(
  app: FastifyInstance,
  db: any,
  transmitterId: string,
  body: any
): Promise<ProfileUpdateResult> {
  const [user] = await db.select().from(transmitters).where(eq(transmitters.id, transmitterId)).limit(1);
  if (!user) return { status: 404, body: { error: 'Transmitter not found' } };

  const updates: Record<string, any> = { updatedAt: new Date() };

  if (body.username !== undefined) {
    const newUsername = String(body.username).trim().toLowerCase();
    if (!isValidUsername(newUsername)) {
      return {
        status: 400,
        body: {
          error: 'Username must be 2-32 characters of lowercase letters, digits, underscore, or period, and cannot start/end with or repeat a period',
          code: 'INVALID_USERNAME',
        },
      };
    }
    if (newUsername !== user.username) {
      // Like Discord, a username change asks for the current password.
      const check = await confirmPassword(db, transmitterId, body.password);
      if (check.fail) return check.fail;
      const newDisc = await allocateDiscriminator(db, newUsername);
      if (!newDisc) {
        return {
          status: 409,
          body: { error: 'All discriminator tags for this username are currently in use', code: 'DISCRIMINATOR_POOL_EXHAUSTED' },
        };
      }
      updates.username = newUsername;
      updates.discriminator = newDisc;
    }
  }

  if (body.displayName !== undefined) {
    const trimmed = String(body.displayName).trim();
    if (trimmed.length > 32) return { status: 400, body: { error: 'Display name cannot exceed 32 characters' } };
    updates.displayName = trimmed.length > 0 ? trimmed : updates.username || user.username;
  }

  if (body.pronouns !== undefined) {
    if (body.pronouns !== null && String(body.pronouns).length > MAX_PRONOUNS_LENGTH) {
      return { status: 400, body: { error: `Pronouns cannot exceed ${MAX_PRONOUNS_LENGTH} characters` } };
    }
    updates.pronouns = body.pronouns;
  }

  if (body.bio !== undefined) {
    if (body.bio !== null && String(body.bio).length > MAX_BIO_LENGTH) {
      return { status: 400, body: { error: `Bio cannot exceed ${MAX_BIO_LENGTH} characters` } };
    }
    updates.bio = body.bio;
  }

  if (body.avatarUrl !== undefined) {
    if (!(await validateMediaUrl(db, transmitterId, body.avatarUrl, ['avatar']))) {
      return { status: 400, body: { error: 'Invalid media URL for avatarUrl', code: 'INVALID_MEDIA_URL' } };
    }
    updates.avatarUrl = body.avatarUrl;
  }

  if (body.bannerUrl !== undefined) {
    if (!(await validateMediaUrl(db, transmitterId, body.bannerUrl, ['banner']))) {
      return { status: 400, body: { error: 'Invalid media URL for bannerUrl', code: 'INVALID_MEDIA_URL' } };
    }
    updates.bannerUrl = body.bannerUrl;
  }

  for (const field of ['bannerColor', 'themePrimary', 'themeAccent'] as const) {
    if (body[field] !== undefined) {
      if (body[field] !== null && !HEX_COLOR_REGEX.test(body[field])) {
        return { status: 400, body: { error: `${field} must be a #RRGGBB hex color or null` } };
      }
      updates[field] = body[field];
    }
  }

  if (body.displayFont !== undefined) updates.displayFont = body.displayFont;
  if (body.displayColor !== undefined) updates.displayColor = body.displayColor;

  if (body.displayNameStyle !== undefined) {
    if (!isValidDisplayNameStyle(body.displayNameStyle)) {
      return { status: 400, body: { error: 'Invalid displayNameStyle' } };
    }
    updates.displayNameStyle = body.displayNameStyle;
  }

  if (body.customStatus !== undefined) {
    const status = body.customStatus;
    if (status !== null) {
      if (typeof status !== 'object' || typeof status.text !== 'string' || [...status.text].length > MAX_CUSTOM_STATUS_LENGTH) {
        return { status: 400, body: { error: `customStatus.text is required and must be <= ${MAX_CUSTOM_STATUS_LENGTH} characters` } };
      }
      if (status.emoji !== undefined && status.emoji !== null && (typeof status.emoji !== 'string' || status.emoji.length > 64)) {
        return { status: 400, body: { error: 'customStatus.emoji must be an emoji' } };
      }
      if (status.expiresAt !== undefined && status.expiresAt !== null && Number.isNaN(Date.parse(status.expiresAt))) {
        return { status: 400, body: { error: 'customStatus.expiresAt must be a date' } };
      }
    }
    // Only the known fields are kept: nothing else rides along to everyone who sees the status.
    updates.customStatus =
      status === null ? null : { text: status.text.trim(), ...(status.emoji ? { emoji: status.emoji } : {}), ...(status.expiresAt ? { expiresAt: new Date(status.expiresAt).toISOString() } : {}) };
  }

  if (body.avatarDecoration !== undefined) {
    if (body.avatarDecoration !== null && !(AVATAR_DECORATIONS as readonly string[]).includes(body.avatarDecoration)) {
      return { status: 400, body: { error: 'Unknown avatar decoration', code: 'INVALID_DECORATION' } };
    }
    updates.avatarDecoration = body.avatarDecoration;
  }

  if (body.profileEffect !== undefined) {
    if (body.profileEffect !== null && !(PROFILE_EFFECTS as readonly string[]).includes(body.profileEffect)) {
      return { status: 400, body: { error: 'Unknown profile effect', code: 'INVALID_EFFECT' } };
    }
    updates.profileEffect = body.profileEffect;
  }

  if (body.profileVisibility !== undefined) {
    if (!PROFILE_VISIBILITY_LEVELS.includes(body.profileVisibility)) {
      return { status: 400, body: { error: 'profileVisibility must be one of everyone, beacons, friends' } };
    }
    updates.profileVisibility = body.profileVisibility;
  }

  if (body.activityVisibility !== undefined) {
    if (!(ACTIVITY_VISIBILITY as readonly string[]).includes(body.activityVisibility)) {
      return { status: 400, body: { error: 'activityVisibility must be one of off, everyone, friends' } };
    }
    updates.activityVisibility = body.activityVisibility;
  }

  // Privacy › "Allow DMs from other members in beacons I join"; Discord offers to apply it to
  // every beacon you are already in too.
  if (body.defaultAllowDms !== undefined) {
    updates.defaultAllowDms = Boolean(body.defaultAllowDms);
    if (body.applyToExistingBeacons === true) {
      await db.update(beaconMembers).set({ allowDms: updates.defaultAllowDms }).where(eq(beaconMembers.transmitterId, transmitterId));
    }
  }

  const [updatedUser] = await db.update(transmitters).set(updates).where(eq(transmitters.id, transmitterId)).returning();

  // USER_UPDATE: public profile fields go to presence peers; the full self profile goes to the user.
  const { resolvePresencePeers } = await import('@subspace/database');
  const peers = await resolvePresencePeers(db, transmitterId);
  await publishGatewayEvent(app, 'USER_UPDATE', { user: serializePublicTransmitter(updatedUser) }, { transmitterIds: peers.filter((id: string) => id !== transmitterId) });
  await publishGatewayEvent(app, 'USER_UPDATE', { user: serializeTransmitter(updatedUser) }, { transmitterIds: [transmitterId] });
  // The gateway rereads Activity Privacy and shares (or stops sharing) what they are playing.
  if (updates.activityVisibility !== undefined) await publishSessionRefresh(app, [transmitterId]);

  return { status: 200, body: { message: 'Profile updated successfully', transmitter: serializeTransmitter(updatedUser) } };
}

/**
 * A bot's application for its profile card: its global slash commands, and whether the viewer may
 * add it to a beacon (anyone, if its developer made it public; otherwise only its developers).
 */
async function botApplication(db: any, botUserId: string, viewer: string) {
  const [row] = await db
    .select({ app: oauthApps, isPublic: appBots.isPublic })
    .from(appBots)
    .innerJoin(oauthApps, eq(oauthApps.id, appBots.appId))
    .where(eq(appBots.userId, botUserId))
    .limit(1);
  if (!row) return null;
  const commands = await db
    .select({ name: appCommands.name, description: appCommands.description })
    .from(appCommands)
    .where(and(eq(appCommands.appId, row.app.id), isNull(appCommands.beaconId)))
    .orderBy(appCommands.name);
  return {
    id: row.app.id,
    name: row.app.name,
    description: row.app.description,
    isPublic: row.isPublic,
    canAdd: row.isPublic || appRoleAtLeast(await appRole(db, row.app, viewer), 'developer'),
    commands,
  };
}

export const profileRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * PATCH /api/v1/users/@me/profile
   */
  app.patch('/@me/profile', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const result = await applyProfileUpdate(app, db, token.transmitterId, request.body || {});
    return reply.status(result.status).send(result.body);
  });

  /**
   * PUT /api/v1/users/@me/changelog  { platform, seen }
   * What's New: the newest changelog entry they have seen on this platform. Only this platform's
   * mark changes, so the web and desktop apps never overwrite each other.
   */
  app.put(
    '/@me/changelog',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['platform', 'seen'],
          properties: { platform: { type: 'string', enum: ['web', 'desktop', 'mobile'] }, seen: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$' } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { platform, seen } = request.body as { platform: 'web' | 'desktop' | 'mobile'; seen: string };
      const [row] = await db
        .update(transmitters)
        .set({ changelogSeen: sql`${transmitters.changelogSeen} || jsonb_build_object(${platform}::text, ${seen}::text)` })
        .where(eq(transmitters.id, token.transmitterId))
        .returning({ changelogSeen: transmitters.changelogSeen });
      return reply.send({ changelogSeen: row?.changelogSeen ?? {} });
    }
  );

  /**
   * GET /api/v1/users/:id/profile?beaconId=
   */
  app.get('/:id/profile', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: targetId } = request.params as { id: string };
    const { beaconId } = (request.query as any) || {};

    const [target] = await db.select().from(transmitters).where(eq(transmitters.id, targetId)).limit(1);
    if (!target) return reply.status(404).send({ error: 'Transmitter not found' });

    const isSelf = targetId === token.transmitterId;

    // Blocks are always honoured (in either direction), regardless of visibility setting.
    const [blocked] = await db
      .select()
      .from(signalBlacklist)
      .where(
        or(
          and(eq(signalBlacklist.transmitterId, targetId), eq(signalBlacklist.targetId, token.transmitterId), eq(signalBlacklist.targetType, 'transmitter')),
          and(eq(signalBlacklist.transmitterId, token.transmitterId), eq(signalBlacklist.targetId, targetId), eq(signalBlacklist.targetType, 'transmitter'))
        )
      )
      .limit(1);
    if (blocked && !isSelf) return reply.status(404).send({ error: 'Transmitter not found' });

    const [affiliation] = await db
      .select()
      .from(affiliations)
      .where(
        or(
          and(eq(affiliations.transmitterId, token.transmitterId), eq(affiliations.targetId, targetId)),
          and(eq(affiliations.transmitterId, targetId), eq(affiliations.targetId, token.transmitterId))
        )
      )
      .limit(1);

    let relationship: 'self' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none' = 'none';
    if (isSelf) relationship = 'self';
    else if (affiliation) {
      if (affiliation.status === 'accepted') relationship = 'friend';
      else if (affiliation.transmitterId === token.transmitterId) relationship = 'outgoing';
      else relationship = 'incoming';
    }

    const myBeaconIds = await resolveTransmitterBeaconIds(db, token.transmitterId);
    const targetBeaconIds = await resolveTransmitterBeaconIds(db, targetId);
    const mutualBeaconIds = myBeaconIds.filter((id: string) => targetBeaconIds.includes(id));

    if (!isSelf) {
      const visibility = target.profileVisibility || 'everyone';
      const shareBeacon = mutualBeaconIds.length > 0;
      const isFriend = relationship === 'friend';
      const allowed =
        visibility === 'everyone' ||
        (visibility === 'beacons' && (shareBeacon || isFriend)) ||
        (visibility === 'friends' && isFriend);
      if (!allowed) return reply.status(404).send({ error: 'Profile not visible' });
    }

    let member: any = undefined;
    if (beaconId && mutualBeaconIds.includes(beaconId)) {
      const [beaconMember] = await db
        .select()
        .from(beaconMembers)
        .where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, targetId)))
        .limit(1);
      if (beaconMember) {
        const beaconClearances = await db.select().from(clearances).where(eq(clearances.beaconId, beaconId));
        const assigned = new Set(beaconMember.clearanceIds || []);
        const memberClearances = beaconClearances.filter((c: any) => assigned.has(c.id));
        member = {
          nickname: beaconMember.nickname,
          avatarUrl: beaconMember.avatarUrl,
          bannerUrl: beaconMember.bannerUrl,
          bio: beaconMember.bio,
          pronouns: beaconMember.pronouns,
          themePrimary: beaconMember.themePrimary,
          themeAccent: beaconMember.themeAccent,
          displayNameStyle: beaconMember.displayNameStyle,
          joinedAt: beaconMember.joinedAt,
          clearances: memberClearances.map((c: any) => ({ id: c.id, name: c.name, color: c.color })),
        };
      }
    }

    await refreshCommendations(app, db, target);
    const visibleCommendations = await db
      .select({
        code: commendations.code,
        name: commendations.name,
        iconUrl: commendations.iconUrl,
        description: commendations.description,
        criteriaType: commendations.criteriaType,
        displayOrder: transmitterCommendations.displayOrder,
      })
      .from(transmitterCommendations)
      .innerJoin(commendations, eq(transmitterCommendations.commendationId, commendations.id))
      .where(and(eq(transmitterCommendations.transmitterId, targetId), eq(transmitterCommendations.isVisible, true)));
    visibleCommendations.sort((a: any, b: any) => a.displayOrder - b.displayOrder);

    const mutualBeaconRows =
      mutualBeaconIds.length > 0
        ? await db.select().from(beacons).where(inArray(beacons.id, mutualBeaconIds))
        : [];

    let note: string | null = null;
    if (!isSelf) {
      const [noteRow] = await db
        .select()
        .from(transmitterNotes)
        .where(and(eq(transmitterNotes.ownerId, token.transmitterId), eq(transmitterNotes.targetId, targetId)))
        .limit(1);
      note = noteRow?.note ?? null;
    }

    return reply.send({
      user: {
        id: target.id,
        username: target.username,
        discriminator: target.discriminator,
        displayName: target.displayName,
        pronouns: target.pronouns,
        avatarUrl: target.avatarUrl,
        bannerUrl: target.bannerUrl,
        bannerColor: target.bannerColor,
        themePrimary: target.themePrimary,
        themeAccent: target.themeAccent,
        bio: target.bio,
        displayNameStyle: target.displayNameStyle,
        customStatus: target.customStatus,
        presence: target.presence,
        createdAt: target.createdAt,
        staffRank: target.staffRank,
        tagBeaconId: target.tagBeaconId,
        avatarDecoration: target.avatarDecoration ?? null,
        profileEffect: target.profileEffect ?? null,
        ...(target.botKind ? { botKind: target.botKind } : {}),
        ...(target.botKind === 'bot' && target.handVerifiedAt ? { botVerified: true } : {}),
      },
      application: target.botKind === 'bot' ? await botApplication(db, target.id, token.transmitterId) : null,
      member,
      commendations: highestPerFamily(visibleCommendations).map(({ displayOrder, criteriaType, ...c }: any) => c),
      mutualBeacons: mutualBeaconRows.map((b: any) => ({ id: b.id, name: b.name, iconUrl: b.iconUrl })),
      mutualFriends: [],
      connections: (
        await db.select().from(accountConnections).where(and(eq(accountConnections.transmitterId, targetId), eq(accountConnections.visible, true))).orderBy(accountConnections.createdAt)
      ).map((c: any) => ({ provider: c.provider, name: c.name, url: c.url })),
      relationship,
      note,
      noteMaxLength: MAX_NOTE_LENGTH,
    });
  });

  /**
   * GET /api/v1/users/:id/note
   */
  app.get('/:id/note', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { id: targetId } = request.params as { id: string };
    const [noteRow] = await db
      .select()
      .from(transmitterNotes)
      .where(and(eq(transmitterNotes.ownerId, token.transmitterId), eq(transmitterNotes.targetId, targetId)))
      .limit(1);

    return reply.send({ note: noteRow?.note ?? null, maxLength: MAX_NOTE_LENGTH });
  });

  /**
   * PUT /api/v1/users/:id/note
   */
  app.put(
    '/:id/note',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['note'],
          properties: { note: { type: 'string', maxLength: MAX_NOTE_LENGTH } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { id: targetId } = request.params as { id: string };
      const { note } = request.body as { note: string };
      // Notes are about people (yourself included): not bots or webhooks, not accounts that do not exist.
      const [target] = /^[1-9][0-9]{0,18}$/.test(targetId)
        ? await db.select({ botKind: transmitters.botKind, deletedAt: transmitters.deletedAt }).from(transmitters).where(eq(transmitters.id, targetId)).limit(1)
        : [];
      if (!target || target.deletedAt) return reply.status(404).send({ error: 'Transmitter not found' });
      if (target.botKind) return reply.status(400).send({ error: 'Notes are for people, not bots', code: 'NOTE_NOT_ALLOWED' });

      if (!note || note.trim().length === 0) {
        await db
          .delete(transmitterNotes)
          .where(and(eq(transmitterNotes.ownerId, token.transmitterId), eq(transmitterNotes.targetId, targetId)));
        return reply.send({ note: null });
      }

      await db
        .insert(transmitterNotes)
        .values({ ownerId: token.transmitterId, targetId, note, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [transmitterNotes.ownerId, transmitterNotes.targetId],
          set: { note, updatedAt: new Date() },
        });

      return reply.send({ note });
    }
  );
};
