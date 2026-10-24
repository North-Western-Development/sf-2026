import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, transmissions } from '@subspace/database';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { safeGet, resolveSafe, UnsafeUrlError } from '../../lib/safe-fetch.js';
import { unfurlCached, verifyProxySignature, parsePageMetadata } from '../../lib/embeds.js';
import { loadChannel, checkChannelAccess } from '../../lib/channels.js';
import { deriveChannel } from '../../lib/transmissions.js';
import { publishGatewayEvent, audienceForTransmission } from '../../lib/events.js';

export { parsePageMetadata as parseMetadata };

/** Raster formats only: SVG can carry script and would run on our origin. */
const PROXY_TYPES = /^image\/(png|jpe?g|gif|webp|avif)$/;
const PROXY_MAX_BYTES = 10 * 1024 * 1024;

export const unfurlRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /**
   * POST /api/v1/unfurl
   * Preview one URL on demand (the same embed that sending it would attach).
   */
  app.post(
    '/unfurl',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['url'],
          properties: { url: { type: 'string', maxLength: 2048 } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      const { url } = request.body as { url: string };
      let target: URL;
      try {
        target = new URL(url);
        await resolveSafe(target);
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof UnsafeUrlError ? err.message : 'Target URL is invalid',
          code: 'INVALID_URL_TARGET',
        });
      }
      const embed = await unfurlCached(app, target.href);
      if (!embed) return reply.status(502).send({ error: 'Nothing to preview at that link', code: 'UNFURL_FAILED' });
      return reply.send({ embed, metadata: { url: embed.url, title: embed.title, description: embed.description, siteName: embed.siteName, thumbnail: (embed.image ?? embed.thumbnail)?.url } });
    }
  );

  /**
   * GET /api/v1/embed-proxy?url=...&sig=...
   * Serves embed images so viewers never connect to third-party hosts. Public because <img>
   * cannot send a bearer token; only URLs the server signed are fetched, never arbitrary ones.
   */
  app.get(
    '/embed-proxy',
    {
      config: { public: true },
      schema: {
        querystring: {
          type: 'object',
          required: ['url', 'sig'],
          properties: { url: { type: 'string', maxLength: 2048 }, sig: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      const { url, sig } = request.query as { url: string; sig: string };
      if (!verifyProxySignature(url, sig)) return reply.status(403).send({ error: 'Invalid signature' });
      try {
        const res = await safeGet(url, { maxBytes: PROXY_MAX_BYTES, timeoutMs: 8000, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' });
        const type = res.contentType.split(';')[0].trim();
        if (res.status !== 200 || !PROXY_TYPES.test(type)) return reply.status(404).send({ error: 'Image unavailable' });
        return reply
          .header('Content-Type', type)
          .header('Cache-Control', 'public, max-age=86400, immutable')
          .header('Content-Security-Policy', "default-src 'none'; sandbox")
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cross-Origin-Resource-Policy', 'same-site')
          .send(res.body);
      } catch {
        return reply.status(404).send({ error: 'Image unavailable' });
      }
    }
  );

  /**
   * DELETE /api/v1/transmissions/:id/embeds
   * Remove a transmission's link previews (its author, or anyone who can manage transmissions).
   */
  app.delete(
    '/transmissions/:id/embeds',
    { schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { id } = request.params as { id: string };
      const [row] = await db.select().from(transmissions).where(eq(transmissions.id, id)).limit(1);
      const derived = row ? deriveChannel(row) : null;
      const channel = derived ? await loadChannel(db, derived.channelType, derived.channelId) : null;
      if (!row || !channel) return reply.status(404).send({ error: 'Transmission not found' });
      const view = await checkChannelAccess(db, channel, token.transmitterId, 'view');
      if (!view.allowed) return reply.status(404).send({ error: 'Transmission not found' });
      if (row.transmitterId !== token.transmitterId) {
        const manage = await checkChannelAccess(db, channel, token.transmitterId, 'manage');
        if (!manage.allowed || channel.channelType === 'link' || channel.channelType === 'mesh') {
          return reply.status(403).send({ error: 'Only the author or a moderator can remove embeds' });
        }
      }
      await db.update(transmissions).set({ embeds: [], suppressEmbeds: true }).where(eq(transmissions.id, id));
      await publishGatewayEvent(
        app,
        'TRANSMISSION_EMBEDS_UPDATE',
        { channelType: channel.channelType, channelId: channel.channelId, transmissionId: id, embeds: [] },
        await audienceForTransmission(db, row)
      );
      return reply.status(204).send();
    }
  );
};
