import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, relays } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { requireSecret } from '@subspace/crypto';
import { createLiveKitAccessToken } from './livekit.js';

const LIVEKIT_API_KEY = requireSecret('LIVEKIT_API_KEY', 'subspace_api_key');
const LIVEKIT_API_SECRET = requireSecret('LIVEKIT_API_SECRET', 'subspace_secret_key_frequency');
// Browser-facing signaling URL. Null means "same origin": the web proxy forwards /rtc to LiveKit.
const LIVEKIT_PUBLIC_URL = process.env.LIVEKIT_PUBLIC_URL || null;

export const commLinkRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/relays/:relayId/comm-link/token
   * Validates clearances and generates a LiveKit WebRTC session token
   */
  app.post('/token', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { relayId } = request.params as { relayId: string };

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!targetRelay) return reply.status(404).send({ error: 'Relay not found' });

    if (targetRelay.type !== 'comm_link') {
      return reply.status(400).send({
        error: 'Target relay is not a Comm-Link relay',
        code: 'NOT_A_COMM_LINK_RELAY',
      });
    }

    const actorContext = await resolveRelayActorContext(db, token.transmitterId, targetRelay);
    if (!actorContext) {
      return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    }

    // Permission check for voice/video connection
    const canConnect =
      actorContext.isOwner ||
      hasPermission(actorContext.effectivePermissions, PERMISSIONS.CONNECT_AUDIO);

    if (!canConnect) {
      return reply.status(403).send({
        error: 'Transmitter lacks CONNECT_AUDIO clearance',
        code: 'FORBIDDEN_CLEARANCE',
      });
    }

    try {
      const roomToken = createLiveKitAccessToken({
        apiKey: LIVEKIT_API_KEY,
        apiSecret: LIVEKIT_API_SECRET,
        identity: token.transmitterId,
        name: token.username,
        roomName: relayId,
        permissions: actorContext.effectivePermissions,
        isOwner: actorContext.isOwner,
      });

      return reply.send({
        message: 'Comm-Link access token issued',
        token: roomToken,
        livekitUrl: LIVEKIT_PUBLIC_URL,
        roomName: relayId,
        canSpeak:
          actorContext.isOwner ||
          hasPermission(actorContext.effectivePermissions, PERMISSIONS.SPEAK_AUDIO),
        canHoloCast:
          actorContext.isOwner ||
          hasPermission(actorContext.effectivePermissions, PERMISSIONS.BROADCAST_HOLO_CAST),
      });
    } catch (err: any) {
      return reply.status(403).send({
        error: err.message,
        code: 'COMM_LINK_TOKEN_REJECTED',
      });
    }
  });

  /**
   * GET /api/v1/relays/:relayId/comm-link/status
   * Get Comm-Link relay metadata and connection parameters
   */
  app.get('/status', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

    const { relayId } = request.params as { relayId: string };

    const [targetRelay] = await db
      .select()
      .from(relays)
      .where(eq(relays.id, relayId))
      .limit(1);

    if (!targetRelay) return reply.status(404).send({ error: 'Relay not found' });
    const actor = await resolveRelayActorContext(db, token.transmitterId, targetRelay);
    if (!actor || !hasPermission(actor.effectivePermissions, PERMISSIONS.VIEW_RELAY)) {
      return reply.status(404).send({ error: 'Relay not found' });
    }

    return reply.send({
      relayId: targetRelay.id,
      name: targetRelay.name,
      type: targetRelay.type,
      topic: targetRelay.topic,
      hasEmbeddedSubchannel: true,
    });
  });
};
