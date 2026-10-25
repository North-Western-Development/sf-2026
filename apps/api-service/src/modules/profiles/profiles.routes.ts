import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
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
} from '@subspace/database';
import {
  isValidUsername,
  HEX_COLOR_REGEX,
  DISPLAY_NAME_STYLE_FONTS,
  DISPLAY_NAME_STYLE_EFFECTS,
  PROFILE_VISIBILITY_LEVELS,
} from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { validateMediaUrl } from '../../lib/media.js';
import { serializePublicTransmitter, serializeTransmitter } from '../../lib/serialize.js';
import { confirmPassword } from '../../lib/confirm-password.js';
import { refreshCommendations } from '../../lib/commendations.js';

const MAX_BIO_LENGTH = 190;
const MAX_PRONOUNS_LENGTH = 40;
const MAX_CUSTOM_STATUS_LENGTH = 128;

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
      if (typeof status !== 'object' || typeof status.text !== 'string' || status.text.length > MAX_CUSTOM_STATUS_LENGTH) {
        return { status: 400, body: { error: `customStatus.text is required and must be <= ${MAX_CUSTOM_STATUS_LENGTH} characters` } };
      }
    }
    updates.customStatus = status;
  }

  if (body.profileVisibility !== undefined) {
    if (!PROFILE_VISIBILITY_LEVELS.includes(body.profileVisibility)) {
      return { status: 400, body: { error: 'profileVisibility must be one of everyone, beacons, friends' } };
    }
    updates.profileVisibility = body.profileVisibility;
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

  return { status: 200, body: { message: 'Profile updated successfully', transmitter: serializeTransmitter(updatedUser) } };
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
      },
      member,
      commendations: highestPerFamily(visibleCommendations).map(({ displayOrder, ...c }: any) => c),
      mutualBeacons: mutualBeaconRows.map((b: any) => ({ id: b.id, name: b.name, iconUrl: b.iconUrl })),
      mutualFriends: [],
      relationship,
      note,
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

    return reply.send({ note: noteRow?.note ?? null });
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
          properties: { note: { type: 'string', maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { id: targetId } = request.params as { id: string };
      const { note } = request.body as { note: string };

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
