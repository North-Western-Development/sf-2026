import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, transmitters } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { resolvePresencePeers } from '@subspace/database';

const MAX_STATUS_TEXT_LENGTH = 128;

export const usersRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * PATCH /api/v1/users/@me/status
   * Update (or clear) the caller's custom status.
   */
  app.patch(
    '/@me/status',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['customStatus'],
          properties: {
            customStatus: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['text'],
                  properties: {
                    text: { type: 'string', maxLength: MAX_STATUS_TEXT_LENGTH },
                    emoji: { type: 'string' },
                    expiresAt: { type: 'string' },
                  },
                },
              ],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });

      const { customStatus } = request.body as { customStatus: { text: string; emoji?: string; expiresAt?: string } | null };

      if (customStatus && customStatus.text.length > MAX_STATUS_TEXT_LENGTH) {
        return reply.status(400).send({ error: `Custom status exceeds ${MAX_STATUS_TEXT_LENGTH} characters` });
      }

      const [updated] = await db
        .update(transmitters)
        .set({ customStatus: customStatus || null, updatedAt: new Date() })
        .where(eq(transmitters.id, token.transmitterId))
        .returning();

      const peers = await resolvePresencePeers(db, token.transmitterId);
      // Live presence lives in the gateway's Redis hash (already masked for invisible);
      // the DB column is stale and broadcasting it made the user appear offline.
      const redis = (app as any).redis;
      const live = redis ? await redis.hget('presence', token.transmitterId).catch(() => null) : null;
      await publishGatewayEvent(
        app,
        'PRESENCE_UPDATE',
        { transmitter_id: token.transmitterId, presence: live || 'offline', custom_status: updated.customStatus },
        { transmitterIds: peers }
      );

      return reply.send({ message: 'Custom status updated', customStatus: updated.customStatus });
    }
  );
};
