import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import { runDataMigrations } from './lib/data-migrations.js';
import { TERMINOLOGY } from '@subspace/constants';
import { createDatabaseClient, loadRegionRanges, logRequest, regionBlocked, REGION_BLOCKED, REGION_BLOCKED_HEADERS, syncCommendationCatalog, ensureDefaultStaffRoles } from '@subspace/database';
import { Redis } from 'ioredis';

// Package-local .env first, then the repo-root .env (native runs); existing env always wins.
dotenv.config({ path: ['.env', '../../.env'] });

const port = Number(process.env.API_PORT) || 3001;
const host = process.env.API_HOST || '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL || 'postgresql://subspace:subspace_secret@postgres:5432/subspace_frequency';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

export async function buildApp() {
  const app = Fastify({
    // A refused (BLOCK_EU) visitor's address is never logged in full.
    logger: process.env.NODE_ENV !== 'test' && { serializers: { req: logRequest as any } },
    // Behind nginx: take the client address from X-Forwarded-For, but only when the hop that
    // sent it is a trusted proxy (TRUST_PROXY; loopback by default, as on a single host).
    // Rate limits and phone verification depend on it.
    trustProxy: process.env.TRUST_PROXY || 'loopback',
  });

  // Every registered route, so the endpoint-coverage security test can sweep them all.
  const routeTable: Array<{ method: string; url: string }> = [];
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) if (method !== 'HEAD' && method !== 'OPTIONS') routeTable.push({ method, url: r.url });
  });
  app.decorate('routeTable', routeTable);

  // BLOCK_EU: nobody in the EU, the EEA or the UK reaches any route, signed in or not.
  loadRegionRanges();
  app.addHook('onRequest', async (request, reply) => {
    // Nothing about the visitor is kept, and the browser drops this site's cookies.
    if (regionBlocked(request.ip)) return reply.status(401).headers(REGION_BLOCKED_HEADERS).send(REGION_BLOCKED);
  });

  // Secure by default: every route needs a valid access token before validation or the
  // handler runs. Routes that must work signed-out opt out with `config: { public: true }`.
  // Imported here, like the route modules, so the JWT secret is read after dotenv runs.
  const { extractAuthToken } = await import('./middleware/hierarchy.js');
  const { sessionExists } = await import('./lib/sessions.js');
  const { resolveBotToken, botMayUse } = await import('./lib/bot-auth.js');
  app.addHook('onRequest', async (request, reply) => {
    const config = request.routeOptions.config as { public?: boolean } | undefined;
    if (!request.routeOptions.url || config?.public) return;
    // Bots sign in with `Authorization: Bot <token>`, and only reach the routes made for them.
    const header = request.headers.authorization;
    if (header?.startsWith('Bot ')) {
      const db = (app as any).db;
      const bot = db ? await resolveBotToken(db, header.slice(4).trim()) : null;
      if (!bot) return reply.status(401).send({ error: 'Invalid bot token', code: 'INVALID_BOT_TOKEN' });
      if (!botMayUse(request.method, request.routeOptions.url)) return reply.status(403).send({ error: 'Bots cannot use this route', code: 'BOT_FORBIDDEN' });
      (request as any).botAuth = bot;
      return;
    }
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    // A signed-out device (Logged-in Devices, password change, account removal) loses access at once.
    const redis = (app as any).redis;
    if (token.sid && redis) {
      const alive = await sessionExists(redis, token.transmitterId, token.sid).catch(() => false);
      if (!alive) return reply.status(401).send({ error: 'Session has been signed out', code: 'SESSION_REVOKED' });
    }
  });

  // Auth is bearer tokens, not cookies; still, only the instance's own origin in production.
  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production' && process.env.PUBLIC_ORIGIN ? process.env.PUBLIC_ORIGIN.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });

  // A malformed or out-of-range id in a path reaches Postgres as invalid input: that is a 404, not a 500.
  app.setErrorHandler((err: any, _request, reply) => {
    if (['22P02', '22003'].includes(err?.code ?? err?.cause?.code)) return reply.status(404).send({ error: 'Not found' });
    // Anything else: Fastify's own handling.
    throw err;
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Database client initialization
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';
  let dbClient: ReturnType<typeof createDatabaseClient> | null = null;
  let redisClient: Redis | null = null;

  try {
    dbClient = createDatabaseClient(databaseUrl);
    await dbClient.pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (err) {
    app.log.warn({ err }, 'PostgreSQL connection delayed or unavailable during boot');
    dbClient = null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });
    redisClient.on('error', (err) => {
      app.log.warn({ err }, 'Redis client background error suppressed');
    });
    await redisClient.connect();
    redisStatus = 'connected';
  } catch (err) {
    app.log.warn({ err }, 'Redis connection delayed or unavailable during boot');
    redisClient = null;
  }

  // Decorate app with db and redis clients
  (app as any).db = dbStatus === 'connected' && dbClient ? dbClient.db : null;
  (app as any).redis = redisStatus === 'connected' ? redisClient : null;
  if ((app as any).db) {
    await syncCommendationCatalog((app as any).db).catch((err) => app.log.warn({ err }, 'Could not sync the commendation catalog'));
    await ensureDefaultStaffRoles((app as any).db).catch((err) => app.log.warn({ err }, 'Could not create the built-in staff ranks'));
  }

  // Rate limiting (section 8): Redis-backed so limits are shared across every instance.
  // Per-route limits are set individually (login, register, 2FA, invite lookup, ...);
  // there is no global default so unlisted routes stay unlimited.
  await app.register(rateLimit, {
    global: false,
    redis: (app as any).redis || undefined,
    nameSpace: 'subspace-rl:',
  });

  // One-time data migrations (recorded, never re-applied).
  if ((app as any).db) {
    try {
      await runDataMigrations((app as any).db, app.log);
    } catch (err) {
      app.log.warn({ err }, 'Data migrations skipped');
    }
  }

  // The Audit Log records admin routes from one hook (see lib/audit-hook.ts).
  const { registerAuditHook } = await import('./lib/audit-hook.js');
  registerAuditHook(app);

  // Import and register routes
  const { authRoutes } = await import('./modules/auth/auth.routes.js');
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  const { passkeyRoutes } = await import('./modules/auth/passkeys.routes.js');
  await app.register(passkeyRoutes, { prefix: '/api/v1/auth/passkeys' });

  const { beaconRoutes } = await import('./modules/beacons/beacons.routes.js');
  await app.register(beaconRoutes, { prefix: '/api/v1/beacons' });
  const { inboxRoutes } = await import('./modules/users/inbox.routes.js');
  await app.register(inboxRoutes, { prefix: '/api/v1' });
  const { accountRoutes } = await import('./modules/users/account.routes.js');
  await app.register(accountRoutes, { prefix: '/api/v1' });
  const { connectionRoutes } = await import('./modules/users/connections.routes.js');
  await app.register(connectionRoutes, { prefix: '/api/v1' });
  const { oauthRoutes } = await import('./modules/oauth/oauth.routes.js');
  await app.register(oauthRoutes, { prefix: '/api/v1' });
  const { stageRoutes } = await import('./modules/media/stage.routes.js');
  await app.register(stageRoutes, { prefix: '/api/v1' });
  const { voiceModerationRoutes } = await import('./modules/media/voice-moderation.routes.js');
  await app.register(voiceModerationRoutes, { prefix: '/api/v1' });
  const { threadRoutes } = await import('./modules/threads/threads.routes.js');
  await app.register(threadRoutes, { prefix: '/api/v1' });
  const { expressionRoutes } = await import('./modules/expression/expression.routes.js');
  await app.register(expressionRoutes, { prefix: '/api/v1' });
  const { activityRoutes } = await import('./modules/activities/activities.routes.js');
  await app.register(activityRoutes, { prefix: '/api/v1' });
  const { appActivityRoutes } = await import('./modules/activities/app-activities.routes.js');
  await app.register(appActivityRoutes, { prefix: '/api/v1' });
  const { beaconExtrasRoutes } = await import('./modules/beacons/extras.routes.js');
  await app.register(beaconExtrasRoutes, { prefix: '/api/v1' });
  const { moderationRoutes } = await import('./modules/moderation/moderation.routes.js');
  await app.register(moderationRoutes, { prefix: '/api/v1/beacons' });
  const { memberSafetyRoutes } = await import('./modules/members/member-safety.routes.js');
  await app.register(memberSafetyRoutes, { prefix: '/api/v1/beacons' });
  const { communityRoutes } = await import('./modules/community/community.routes.js');
  await app.register(communityRoutes, { prefix: '/api/v1/beacons' });
  const { eventRoutes } = await import('./modules/events/events.routes.js');
  await app.register(eventRoutes, { prefix: '/api/v1/beacons' });

  const { clearanceRoutes } = await import('./modules/clearances/clearances.routes.js');
  await app.register(clearanceRoutes, { prefix: '/api/v1/beacons/:id/clearances' });

  const { clusterRoutes } = await import('./modules/clusters/clusters.routes.js');
  await app.register(clusterRoutes, { prefix: '/api/v1/clusters' });

  const { onboardingRoutes } = await import('./modules/onboarding/onboarding.routes.js');
  await app.register(onboardingRoutes, { prefix: '/api/v1/beacons/:id/onboarding' });

  const { relayRoutes } = await import('./modules/relays/relays.routes.js');
  await app.register(relayRoutes, { prefix: '/api/v1/beacons/:beaconId/relays' });

  const { transmissionRoutes } = await import('./modules/transmissions/transmissions.routes.js');
  await app.register(transmissionRoutes, { prefix: '/api/v1' });

  const { messagingRoutes } = await import('./modules/messaging/messaging.routes.js');
  await app.register(messagingRoutes, { prefix: '/api/v1' });
  const { pollRoutes } = await import('./modules/messaging/polls.routes.js');
  await app.register(pollRoutes, { prefix: '/api/v1' });
  const { webhookRoutes } = await import('./modules/webhooks/webhooks.routes.js');
  await app.register(webhookRoutes, { prefix: '/api/v1' });
  const { botRoutes } = await import('./modules/bots/bots.routes.js');
  await app.register(botRoutes, { prefix: '/api/v1' });
  const { teamRoutes } = await import('./modules/teams/teams.routes.js');
  await app.register(teamRoutes, { prefix: '/api/v1' });
  const { announcementRoutes } = await import('./modules/announcements/announcements.routes.js');
  await app.register(announcementRoutes, { prefix: '/api/v1' });
  const { interactionRoutes } = await import('./modules/interactions/interactions.routes.js');
  await app.register(interactionRoutes, { prefix: '/api/v1' });

  const { readStateRoutes } = await import('./modules/messaging/read-state.routes.js');
  await app.register(readStateRoutes, { prefix: '/api/v1' });

  const { usersRoutes } = await import('./modules/users/users.routes.js');
  await app.register(usersRoutes, { prefix: '/api/v1/users' });

  const { linkRoutes } = await import('./modules/links/links.routes.js');
  await app.register(linkRoutes, { prefix: '/api/v1/links' });

  const { meshRoutes } = await import('./modules/meshes/meshes.routes.js');
  await app.register(meshRoutes, { prefix: '/api/v1/meshes' });

  const { callRoutes } = await import('./modules/calls/calls.routes.js');
  await app.register(callRoutes, { prefix: '/api/v1/calls' });
  const { e2eeRoutes } = await import('./modules/e2ee/e2ee.routes.js');
  await app.register(e2eeRoutes, { prefix: '/api/v1/e2ee' });
  const { pushRoutes } = await import('./modules/push/push.routes.js');
  await app.register(pushRoutes, { prefix: '/api/v1/push' });

  const { affiliationRoutes } = await import('./modules/affiliations/affiliations.routes.js');
  await app.register(affiliationRoutes, { prefix: '/api/v1/affiliations' });

  const { requestRoutes } = await import('./modules/requests/requests.routes.js');
  await app.register(requestRoutes, { prefix: '/api/v1/requests' });

  const { blacklistRoutes } = await import('./modules/blacklist/blacklist.routes.js');
  await app.register(blacklistRoutes, { prefix: '/api/v1/blacklist' });

  const { profileRoutes } = await import('./modules/profiles/profiles.routes.js');
  await app.register(profileRoutes, { prefix: '/api/v1/users' });

  const { inviteRoutes } = await import('./modules/invites/invites.routes.js');
  await app.register(inviteRoutes, { prefix: '/api/v1' });

  const { relayOverwriteRoutes } = await import('./modules/relays/overwrites.routes.js');
  await app.register(relayOverwriteRoutes, { prefix: '/api/v1/beacons/:beaconId/relays/:relayId/overwrites' });

  const { unfurlRoutes } = await import('./modules/unfurl/unfurl.js');
  await app.register(unfurlRoutes, { prefix: '/api/v1' });

  const { commLinkRoutes } = await import('./modules/media/comm-link.routes.js');
  await app.register(commLinkRoutes, { prefix: '/api/v1/relays/:relayId/comm-link' });

  const { archivalRoutes } = await import('./modules/archival/archival.routes.js');
  await app.register(archivalRoutes, { prefix: '/api/v1/relays/:relayId/archival' });

  const { visualRoutes } = await import('./modules/visual/visual.routes.js');
  await app.register(visualRoutes, { prefix: '/api/v1/relays/:relayId/visual' });

  const { searchRoutes } = await import('./modules/search/search.routes.js');
  await app.register(searchRoutes, { prefix: '/api/v1/search' });

  const { reportRoutes } = await import('./modules/reports/reports.routes.js');
  await app.register(reportRoutes, { prefix: '/api/v1/reports' });

  const { consoleRoutes } = await import('./modules/console/console.routes.js');
  await app.register(consoleRoutes, { prefix: '/api/v1/console' });
  const { staffRoutes } = await import('./modules/console/staff.routes.js');
  await app.register(staffRoutes, { prefix: '/api/v1/console' });

  const { commendationRoutes } = await import('./modules/commendations/commendations.routes.js');
  await app.register(commendationRoutes, { prefix: '/api/v1/transmitters' });

  // Subspace Vault is served by file-service (/api/v1/vault is routed there by the web proxy).

  // Health check endpoint
  app.get('/health', { config: { public: true } }, async () => {
    return {
      status: 'ok',
      service: 'api-service',
      domain: 'Subspace Frequency',
      lexicon: {
        user: TERMINOLOGY.USER,
        message: TERMINOLOGY.MESSAGE,
        server: TERMINOLOGY.SERVER,
        channel: TERMINOLOGY.CHANNEL,
      },
      database: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  });

  // Diagnostics / System Information
  app.get('/api/v1/system/info', { config: { public: true } }, async () => {
    return {
      instance: 'Subspace Frequency Node',
      version: '0.1.0',
      terminology: TERMINOLOGY,
      status: 'operational',
    };
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = await buildApp();
  try {
    await app.listen({ port, host });
    console.log(`[API Service] Comm-Link listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
