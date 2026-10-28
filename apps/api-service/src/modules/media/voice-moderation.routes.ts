import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, beacons, beaconMembers, relays } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { requireSecret } from '@subspace/crypto';
import { extractAuthToken, resolveBeaconActorContext, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { buildMember } from '../../lib/members.js';
import { readStage } from './stage.routes.js';
import { publishSources, removeLiveKitParticipant, updateLiveKitParticipant } from './livekit.js';

const LIVEKIT_API_KEY = requireSecret('LIVEKIT_API_KEY', 'subspace_api_key');
const LIVEKIT_API_SECRET = requireSecret('LIVEKIT_API_SECRET', 'subspace_secret_key_frequency');
/** The gateway mirrors who is in which comm-link or stage here (transmitter id -> relay id). */
const VOICE_HASH = 'voice:relay';
const VOICE_TYPES = ['comm_link', 'stage'];

/**
 * Voice moderation (Discord's): a moderator server-mutes or deafens a member, moves them to
 * another comm-link, or disconnects them.
 *   PATCH /beacons/:beaconId/voice-states/:userId   { mute?, deafen?, relayId? }
 *     mute / deafen    Mute Members / Deafen Members; kept on the member until lifted, also on later joins
 *     relayId: id      Move Members; they must be connected, and may see the destination
 *     relayId: null    Move Members; disconnect them
 * LiveKit enforces it (permissions change, or they are dropped from the room), and the member's
 * client hears VOICE_MODERATION to follow along.
 */
export const voiceModerationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = () => {
    const r = (app as any).redis;
    return r?.status === 'ready' ? r : null;
  };

  app.patch(
    '/beacons/:beaconId/voice-states/:userId',
    {
      schema: {
        params: { type: 'object', properties: { beaconId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, userId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            mute: { type: 'boolean' },
            deafen: { type: 'boolean' },
            relayId: { anyOf: [{ type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, { type: 'null' }] },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db || !redis()) return reply.status(503).send({ error: 'Voice moderation is unavailable right now' });
      const { beaconId, userId } = request.params as { beaconId: string; userId: string };
      const body = request.body as { mute?: boolean; deafen?: boolean; relayId?: string | null };

      const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
      if (!actor) return reply.status(404).send({ error: 'Beacon not found' });
      const [beacon] = await db.select({ ownerId: beacons.ownerId }).from(beacons).where(eq(beacons.id, beaconId)).limit(1);
      const [member] = await db.select().from(beaconMembers).where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, userId))).limit(1);
      if (!member) return reply.status(404).send({ error: 'They are not a member of this beacon', code: 'NOT_A_MEMBER' });
      // Nobody moderates the owner but the owner.
      if (userId === beacon.ownerId && token.transmitterId !== beacon.ownerId) return reply.status(403).send({ error: 'You cannot moderate the beacon owner', code: 'TARGET_IS_OWNER' });

      const can = (p: bigint) => actor.isOwner || hasPermission(actor.effectivePermissions, p);
      const wantsVoiceFlags = body.mute !== undefined || body.deafen !== undefined;
      if (body.mute !== undefined && !can(PERMISSIONS.MUTE_MEMBERS)) return reply.status(403).send({ error: 'Transmitter lacks MUTE_MEMBERS clearance', code: 'MISSING_PERMISSIONS' });
      if (body.deafen !== undefined && !can(PERMISSIONS.DEAFEN_MEMBERS)) return reply.status(403).send({ error: 'Transmitter lacks DEAFEN_MEMBERS clearance', code: 'MISSING_PERMISSIONS' });
      if (body.relayId !== undefined && !can(PERMISSIONS.MOVE_MEMBERS)) return reply.status(403).send({ error: 'Transmitter lacks MOVE_MEMBERS clearance', code: 'MISSING_PERMISSIONS' });

      // Where they are now: only voice relays of this beacon count.
      const currentId: string | null = await redis().hget(VOICE_HASH, userId);
      const [current] = currentId ? await db.select().from(relays).where(eq(relays.id, currentId)).limit(1) : [];
      const here = current && current.beaconId === beaconId && VOICE_TYPES.includes(current.type) ? current : null;

      let destination: any = null;
      if (body.relayId !== undefined) {
        if (!here) return reply.status(400).send({ error: 'They are not connected to voice here', code: 'NOT_IN_VOICE' });
        if (body.relayId) {
          [destination] = await db.select().from(relays).where(eq(relays.id, body.relayId)).limit(1);
          if (!destination || destination.beaconId !== beaconId || !VOICE_TYPES.includes(destination.type)) {
            return reply.status(400).send({ error: 'Move them to a comm-link or stage in this beacon', code: 'INVALID_DESTINATION' });
          }
          // The mover must be able to reach it, and the member must be able to see it.
          const mine = await resolveRelayActorContext(db, token.transmitterId, destination);
          const theirs = await resolveRelayActorContext(db, userId, destination);
          const sees = (c: any) => c && (c.isOwner || hasPermission(c.effectivePermissions, PERMISSIONS.VIEW_RELAY));
          if (!sees(mine) || !sees(theirs)) return reply.status(403).send({ error: 'They cannot be moved there', code: 'DESTINATION_FORBIDDEN' });
        }
      }

      const serverMuted = body.mute ?? member.serverMuted;
      const serverDeafened = body.deafen ?? member.serverDeafened;
      if (wantsVoiceFlags) {
        await db.update(beaconMembers).set({ serverMuted, serverDeafened }).where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, userId)));
      }

      const keys = { apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET };
      if (body.relayId !== undefined && here) {
        await removeLiveKitParticipant({ ...keys, room: here.id, identity: userId });
      } else if (wantsVoiceFlags && here) {
        const ctx = await resolveRelayActorContext(db, userId, here);
        const audience = here.type === 'stage' && !(await readStage(redis(), here.id)).speakers.includes(userId);
        const sources = ctx ? publishSources(ctx.effectivePermissions, ctx.isOwner, { audience, serverMuted, serverDeafened }) : [];
        await updateLiveKitParticipant({ ...keys, room: here.id, identity: userId, sources, serverDeafened });
      }

      await publishGatewayEvent(
        app,
        'VOICE_MODERATION',
        {
          beaconId,
          relayId: here?.id ?? null,
          serverMuted,
          serverDeafened,
          ...(body.relayId !== undefined ? { moveTo: destination?.id ?? null, moveToName: destination?.name ?? null } : {}),
          by: token.transmitterId,
        },
        { transmitterIds: [userId] }
      );
      if (wantsVoiceFlags) await publishGatewayEvent(app, 'MEMBER_UPDATE', { beaconId, member: await buildMember(db, redis(), beaconId, userId) }, { beaconId });
      return reply.send({ serverMuted, serverDeafened, relayId: body.relayId !== undefined ? destination?.id ?? null : here?.id ?? null });
    }
  );
};
