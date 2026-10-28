import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { eq, appActivities } from '@subspace/database';
import type { AppRole } from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { appWithRole } from '../../lib/app-access.js';
import { checkActivityUrl, launchableActivities, publicActivityApp, ACTIVITY_URL_MAX } from '../../lib/app-activities.js';

const isId = (s: unknown): s is string => typeof s === 'string' && /^[1-9][0-9]{0,18}$/.test(s);

/** What its developers see of an application's Activity. */
const serialize = (row: any) => ({
  name: row.name,
  description: row.description,
  url: row.url,
  maxParticipants: row.maxParticipants,
  approved: !!row.approvedAt,
  approvedAt: row.approvedAt,
  updatedAt: row.updatedAt,
});

/**
 * Custom Activities, the developer side (User Settings › Developer Applications › Activity) and
 * the launcher's list. Running them lives with the built-in ones in activities.routes.ts;
 * staff approval in Command Console › Activities (console.routes.ts).
 *   GET|PUT|DELETE /applications/:id/activity   its Activity (read-only role reads; developer edits)
 *   GET /activities/apps                        what I may launch: approved ones, and my own to test
 */
export const appActivityRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function appFor(request: FastifyRequest, reply: any, needed: AppRole) {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    const token = extractAuthToken(request)!;
    const { id } = request.params as { id: string };
    if (!isId(id)) return reply.status(404).send({ error: 'Application not found' }), null;
    const found = await appWithRole(db, id, token.transmitterId, needed);
    if (found.error === 404) return reply.status(404).send({ error: 'Application not found' }), null;
    if (found.error === 403) return reply.status(403).send({ error: 'Your team role does not allow that', code: 'TEAM_ROLE_TOO_LOW' }), null;
    return found as { app: any; role: AppRole };
  }

  app.get('/applications/:id/activity', async (request, reply) => {
    const ctx = await appFor(request, reply, 'read_only');
    if (!ctx) return;
    const [row] = await db.select().from(appActivities).where(eq(appActivities.appId, ctx.app.id)).limit(1);
    return reply.send({ activity: row ? serialize(row) : null });
  });

  app.put(
    '/applications/:id/activity',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'url'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 32 },
            description: { type: ['string', 'null'], maxLength: 200 },
            url: { type: 'string', minLength: 8, maxLength: ACTIVITY_URL_MAX },
            maxParticipants: { type: 'integer', minimum: 1, maximum: 99 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = await appFor(request, reply, 'developer');
      if (!ctx) return;
      const body = request.body as { name: string; description?: string | null; url: string; maxParticipants?: number };
      const checked = await checkActivityUrl(body.url);
      if (!checked.ok) return reply.status(400).send({ error: checked.error, code: 'INVALID_ACTIVITY_URL' });
      const [existing] = await db.select().from(appActivities).where(eq(appActivities.appId, ctx.app.id)).limit(1);
      const values = {
        name: body.name.trim(),
        description: body.description?.trim() || null,
        url: checked.url,
        maxParticipants: body.maxParticipants ?? existing?.maxParticipants ?? 16,
        updatedAt: new Date(),
      };
      let row;
      if (existing) {
        // A different page is a different review: the approval goes with the old URL.
        const moved = existing.url !== checked.url;
        [row] = await db
          .update(appActivities)
          .set({ ...values, ...(moved ? { approvedAt: null, approvedBy: null } : {}) })
          .where(eq(appActivities.appId, ctx.app.id))
          .returning();
      } else {
        [row] = await db.insert(appActivities).values({ appId: ctx.app.id, ...values }).returning();
      }
      return reply.status(existing ? 200 : 201).send({ activity: serialize(row) });
    }
  );

  app.delete('/applications/:id/activity', async (request, reply) => {
    const ctx = await appFor(request, reply, 'developer');
    if (!ctx) return;
    await db.delete(appActivities).where(eq(appActivities.appId, ctx.app.id));
    return reply.status(204).send();
  });

  app.get('/activities/apps', async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const token = extractAuthToken(request)!;
    const list = await launchableActivities(db, token.transmitterId);
    return reply.header('cache-control', 'private, no-store').send({ activities: list.map((a) => publicActivityApp(a)) });
  });
};
