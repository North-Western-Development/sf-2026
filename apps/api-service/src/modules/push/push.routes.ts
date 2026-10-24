import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, pushTokens } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';

const TOKEN = { type: 'string', pattern: '^Expo(nent)?PushToken\\[[A-Za-z0-9_-]{10,200}\\]$' };

/** Mobile app installs register their Expo push token here once signed in. */
export const pushRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /** POST /api/v1/push/tokens  { token, platform } — a token moves to whoever signs in on that install. */
  app.post(
    '/tokens',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: { token: TOKEN, platform: { type: 'string', enum: ['ios', 'android', 'web', 'unknown'] } },
        },
      },
    },
    async (request, reply) => {
      const auth = extractAuthToken(request)!;
      const { token, platform = 'unknown' } = request.body as { token: string; platform?: string };
      await db
        .insert(pushTokens)
        .values({ token, transmitterId: auth.transmitterId, platform })
        .onConflictDoUpdate({ target: pushTokens.token, set: { transmitterId: auth.transmitterId, platform, createdAt: new Date() } });
      return reply.status(204).send();
    }
  );

  /** POST /api/v1/push/tokens/remove  { token } — on sign-out; only your own. */
  app.post(
    '/tokens/remove',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: TOKEN } } } },
    async (request, reply) => {
      const auth = extractAuthToken(request)!;
      const { token } = request.body as { token: string };
      await db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.transmitterId, auth.transmitterId)));
      return reply.status(204).send();
    }
  );
};
