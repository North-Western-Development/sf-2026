import crypto from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, eq, or, isNull, inArray, isNotNull, devTeams, devTeamMembers, loadDeveloperPolicy, accountVerification, appBots, beaconMembers, beacons, oauthApps, oauthGrants, oauthTokens, transmitters } from '@subspace/database';
import { appRole, appWithRole } from '../../lib/app-access.js';
import { validateMediaUrl } from '../../lib/media.js';
import { renameAppUser } from '../../lib/app-users.js';
import { PRIVILEGED_INTENTS, type AppRole, appRoleAtLeast, appCreationCheck, isVerifiedAccount, mayUseIntent, verifiedMeans } from '@subspace/constants';
import { extractAuthToken } from '../../middleware/hierarchy.js';
import { emailVerificationEnabled } from '../../lib/mailer.js';

/**
 * A small OAuth2 provider, so apps can "Sign in with Subspace" (Discord's OAuth2 and
 * Authorized Apps). Authorization code grant with optional PKCE, refresh tokens, revocation.
 * App tokens only reach /oauth2/@me and /oauth2/@me/beacons, never the rest of the API.
 *
 * Developers:  GET|POST /applications, PATCH|DELETE /applications/:id, POST /applications/:id/secret
 * Consent:     GET /oauth2/applications/:id, POST /oauth2/authorize
 * Apps:        POST /oauth2/token, POST /oauth2/token/revoke, GET /oauth2/@me, GET /oauth2/@me/beacons
 * You:         GET /users/@me/oauth2/grants, DELETE /users/@me/oauth2/grants/:id  (Authorized Apps)
 */

export const SCOPES = ['identify', 'email', 'beacons'] as const;
const ACCESS_TTL_S = 7 * 86_400;
const REFRESH_TTL_S = 30 * 86_400;
const CODE_TTL_S = 600;
const MAX_APPS = 25;

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
const isId = (s: unknown): s is string => typeof s === 'string' && /^[1-9][0-9]{0,18}$/.test(s);
/** Redirect URIs: https anywhere, or http only to this machine (for development). */
const validRedirect = (u: string) => {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
};
/** An application as its developers see it, with what the viewer may do with it. */
const serializeApp = (a: any, role: AppRole = 'owner') => ({ id: a.id, name: a.name, description: a.description, iconUrl: a.iconUrl, redirectUris: a.redirectUris, teamId: a.teamId ?? null, role, createdAt: a.createdAt });

const APP_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 32 },
    description: { type: ['string', 'null'], maxLength: 400 },
    /** An image the caller uploaded with purpose app_icon, or null to remove it. */
    iconUrl: { type: ['string', 'null'], maxLength: 500 },
    redirectUris: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 500 } },
  },
};

export const oauthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = () => {
    const r = (app as any).redis;
    return r?.status === 'ready' ? r : null;
  };

  // The token endpoints take form posts, as OAuth2 clients send them.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  // ---------------------------------------------------------------- Developers

  /** The application in the URL, if the caller has at least `needed` on it (owner or team role); otherwise replies. */
  async function appFor(request: FastifyRequest, reply: any, needed: AppRole) {
    const token = extractAuthToken(request)!;
    const { id } = request.params as { id: string };
    if (!isId(id)) return reply.status(404).send({ error: 'Application not found' }), null;
    const found = await appWithRole(db, id, token.transmitterId, needed);
    if (found.error === 404) return reply.status(404).send({ error: 'Application not found' }), null;
    if (found.error === 403) return reply.status(403).send({ error: 'Your team role does not allow that', code: 'TEAM_ROLE_TOO_LOW' }), null;
    return found as { app: any; role: AppRole };
  }

  app.get('/applications', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    // My own, and those of the teams I am in (as owner or an accepted member), with my role on each.
    const mine = await db.select().from(oauthApps).where(and(eq(oauthApps.ownerId, token.transmitterId), isNull(oauthApps.teamId))).orderBy(oauthApps.createdAt);
    const teamRows = await db
      .select({ app: oauthApps, ownerId: devTeams.ownerId, role: devTeamMembers.role })
      .from(oauthApps)
      .innerJoin(devTeams, eq(devTeams.id, oauthApps.teamId))
      .leftJoin(devTeamMembers, and(eq(devTeamMembers.teamId, devTeams.id), eq(devTeamMembers.transmitterId, token.transmitterId), isNotNull(devTeamMembers.acceptedAt)))
      .where(or(eq(devTeams.ownerId, token.transmitterId), isNotNull(devTeamMembers.role)))
      .orderBy(oauthApps.createdAt);
    return reply.send({
      applications: [
        ...mine.map((a: any) => serializeApp(a)),
        ...teamRows.map((r: any) => serializeApp(r.app, r.ownerId === token.transmitterId ? 'owner' : r.role)),
      ],
    });
  });

  /**
   * GET /api/v1/applications/policy
   * What this instance lets me do as a developer (Command Console › Developers), and why not.
   */
  app.get('/applications/policy', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const [policy, me] = await Promise.all([loadDeveloperPolicy(db), accountVerification(db, token.transmitterId)]);
    return reply.send({
      verification: { ...me, verified: isVerifiedAccount(me, policy) },
      verifiedMeans: verifiedMeans(policy),
      createApps: appCreationCheck(me, policy),
      intents: Object.fromEntries(PRIVILEGED_INTENTS.map((i) => [i, { allowed: mayUseIntent(me, policy, i), audience: policy.intents[i] }])),
    });
  });

  app.post('/applications', { schema: { body: { ...APP_BODY, required: ['name'] } } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const check = appCreationCheck(await accountVerification(db, token.transmitterId), await loadDeveloperPolicy(db));
    if (!check.allowed) return reply.status(403).send({ error: `Creating applications here needs ${check.missing.join(' and ')}`, code: 'APP_CREATION_RESTRICTED', missing: check.missing });
    const body = request.body as { name: string; description?: string | null; redirectUris?: string[] };
    if (body.redirectUris?.some((u) => !validRedirect(u))) return reply.status(400).send({ error: 'Redirect URIs must be https (or http on localhost) without a #fragment', code: 'INVALID_REDIRECT_URI' });
    const count = await db.select({ id: oauthApps.id }).from(oauthApps).where(eq(oauthApps.ownerId, token.transmitterId));
    if (count.length >= MAX_APPS) return reply.status(400).send({ error: `You can have up to ${MAX_APPS} applications`, code: 'MAX_APPLICATIONS' });
    const clientSecret = secret();
    const [row] = await db
      .insert(oauthApps)
      .values({ ownerId: token.transmitterId, name: body.name.trim(), description: body.description ?? null, redirectUris: body.redirectUris ?? [], clientSecretHash: sha(clientSecret) })
      .returning();
    return reply.status(201).send({ application: serializeApp(row), clientSecret });
  });

  app.patch('/applications/:id', { schema: { body: APP_BODY } }, async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const ctx = await appFor(request, reply, 'developer');
    if (!ctx) return;
    const row = ctx.app;
    const body = request.body as { name?: string; description?: string | null; iconUrl?: string | null; redirectUris?: string[] };
    if (!body.name && body.description === undefined && body.iconUrl === undefined && !body.redirectUris) return reply.status(400).send({ error: 'Nothing to change', code: 'EMPTY_UPDATE' });
    if (body.redirectUris?.some((u) => !validRedirect(u))) return reply.status(400).send({ error: 'Redirect URIs must be https (or http on localhost) without a #fragment', code: 'INVALID_REDIRECT_URI' });
    // Only an icon this developer uploaded for an application.
    if (body.iconUrl && !(await validateMediaUrl(db, extractAuthToken(request)!.transmitterId, body.iconUrl, ['app_icon']))) {
      return reply.status(400).send({ error: 'Upload the icon first', code: 'INVALID_ICON' });
    }
    const [updated] = await db
      .update(oauthApps)
      .set({
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.iconUrl !== undefined ? { iconUrl: body.iconUrl } : {}),
        ...(body.redirectUris ? { redirectUris: body.redirectUris } : {}),
      })
      .where(eq(oauthApps.id, row.id))
      .returning();
    // Its bot looks the same: name and picture. A verified bot that changes how it looks loses the
    // check until staff verify it again (it was verified as what it looked like then).
    const looksDifferent = updated.name !== row.name || (updated.iconUrl ?? null) !== (row.iconUrl ?? null);
    if (looksDifferent) {
      const [bot] = await db.select({ userId: appBots.userId }).from(appBots).where(eq(appBots.appId, row.id)).limit(1);
      if (bot) {
        await renameAppUser(db, bot.userId, updated.name, updated.iconUrl ?? null);
        await db.update(transmitters).set({ handVerifiedAt: null }).where(eq(transmitters.id, bot.userId));
      }
    }
    return reply.send({ application: serializeApp(updated, ctx.role) });
  });

  app.post('/applications/:id/secret', async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const ctx = await appFor(request, reply, 'developer');
    if (!ctx) return;
    const row = ctx.app;
    const clientSecret = secret();
    await db.update(oauthApps).set({ clientSecretHash: sha(clientSecret) }).where(eq(oauthApps.id, row.id));
    return reply.send({ clientSecret });
  });

  app.delete('/applications/:id', async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const ctx = await appFor(request, reply, 'admin');
    if (!ctx) return;
    const row = ctx.app;
    await db.delete(oauthApps).where(eq(oauthApps.id, row.id));
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- Consent

  app.get('/oauth2/applications/:id', async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { id } = request.params as { id: string };
    if (!isId(id)) return reply.status(404).send({ error: 'Unknown application', code: 'UNKNOWN_APPLICATION' });
    const [row] = await db
      .select({ app: oauthApps, ownerName: transmitters.username, bot: { isPublic: appBots.isPublic, userId: appBots.userId } })
      .from(oauthApps)
      .innerJoin(transmitters, eq(transmitters.id, oauthApps.ownerId))
      .leftJoin(appBots, eq(appBots.appId, oauthApps.id))
      .where(eq(oauthApps.id, id))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'Unknown application', code: 'UNKNOWN_APPLICATION' });
    // `bot`: whether it can be added to beacons (scope=bot), whether I may, and whether staff verified it.
    let bot = null;
    if (row.bot?.userId) {
      const viewer = extractAuthToken(request)?.transmitterId;
      const mine = viewer ? appRoleAtLeast(await appRole(db, row.app, viewer), 'developer') : false;
      const [account] = await db.select({ verified: transmitters.handVerifiedAt }).from(transmitters).where(eq(transmitters.id, row.bot.userId)).limit(1);
      bot = { isPublic: row.bot.isPublic, ownerId: row.app.ownerId, canAdd: row.bot.isPublic || mine, verified: !!account?.verified, userId: row.bot.userId };
    }
    return reply.send({ application: { id: row.app.id, name: row.app.name, description: row.app.description, iconUrl: row.app.iconUrl, owner: row.ownerName, createdAt: row.app.createdAt, bot } });
  });

  /**
   * GET /api/v1/oauth2/verified-games
   * Detected games that staff linked to an application, with that application's icon. The desktop
   * app's page shows the icon instead of the Steam cover when it shares one of these games.
   */
  app.get('/oauth2/verified-games', async (_request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const rows = await db
      .select({ game: oauthApps.detectedGame, id: oauthApps.id, name: oauthApps.name, iconUrl: oauthApps.iconUrl })
      .from(oauthApps)
      .where(isNotNull(oauthApps.detectedGame));
    const games: Record<string, { applicationId: string; name: string; iconUrl: string | null }> = {};
    for (const r of rows) games[r.game!] = { applicationId: r.id, name: r.name, iconUrl: r.iconUrl };
    return reply.header('cache-control', 'private, max-age=300').send({ games });
  });

  app.post(
    '/oauth2/authorize',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['clientId', 'redirectUri', 'scope'],
          properties: {
            clientId: { type: 'string', maxLength: 40 },
            redirectUri: { type: 'string', maxLength: 500 },
            scope: { type: 'string', maxLength: 200 },
            state: { type: 'string', maxLength: 500 },
            codeChallenge: { type: 'string', minLength: 43, maxLength: 128 },
            codeChallengeMethod: { type: 'string', enum: ['S256'] },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      if (!db || !redis()) return reply.status(503).send({ error: 'Authorization is unavailable right now' });
      const body = request.body as { clientId: string; redirectUri: string; scope: string; state?: string; codeChallenge?: string };
      if (!isId(body.clientId)) return reply.status(400).send({ error: 'Unknown application', code: 'UNKNOWN_APPLICATION' });
      const [row] = await db.select().from(oauthApps).where(eq(oauthApps.id, body.clientId)).limit(1);
      if (!row) return reply.status(400).send({ error: 'Unknown application', code: 'UNKNOWN_APPLICATION' });
      // An unregistered redirect is never followed: that is how codes would leak.
      if (!row.redirectUris.includes(body.redirectUri)) return reply.status(400).send({ error: 'That redirect URI is not registered for this application', code: 'INVALID_REDIRECT_URI' });
      const scopes = [...new Set(body.scope.split(/[\s+]+/).filter(Boolean))];
      if (!scopes.length || scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) return reply.status(400).send({ error: 'Unknown scope', code: 'INVALID_SCOPE' });

      const [existing] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.appId, row.id), eq(oauthGrants.transmitterId, token.transmitterId))).limit(1);
      if (existing) {
        await db.update(oauthGrants).set({ scopes: [...new Set([...existing.scopes, ...scopes])] }).where(eq(oauthGrants.id, existing.id));
      } else {
        await db.insert(oauthGrants).values({ appId: row.id, transmitterId: token.transmitterId, scopes });
      }
      const code = secret();
      await redis().set(
        `oauth:code:${sha(code)}`,
        JSON.stringify({ appId: row.id, transmitterId: token.transmitterId, scopes, redirectUri: body.redirectUri, challenge: body.codeChallenge ?? null }),
        'EX',
        CODE_TTL_S
      );
      const location = new URL(body.redirectUri);
      location.searchParams.set('code', code);
      if (body.state) location.searchParams.set('state', body.state);
      return reply.send({ location: location.toString() });
    }
  );

  /**
   * POST /api/v1/oauth2/deny  { clientId, redirectUri, state? }
   * Cancel on the consent page: back to the app with error=access_denied (RFC 6749 §4.1.2.1), but
   * only to a redirect URI it registered, so this is never an open redirect.
   */
  app.post(
    '/oauth2/deny',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['clientId', 'redirectUri'],
          properties: { clientId: { type: 'string', maxLength: 20 }, redirectUri: { type: 'string', maxLength: 500 }, state: { type: 'string', maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const body = request.body as { clientId: string; redirectUri: string; state?: string };
      if (!isId(body.clientId)) return reply.status(400).send({ error: 'Unknown application', code: 'UNKNOWN_APPLICATION' });
      const [row] = await db.select({ redirectUris: oauthApps.redirectUris }).from(oauthApps).where(eq(oauthApps.id, body.clientId)).limit(1);
      if (!row || !row.redirectUris.includes(body.redirectUri)) return reply.status(400).send({ error: 'That redirect URI is not registered for this application', code: 'INVALID_REDIRECT_URI' });
      const location = new URL(body.redirectUri);
      location.searchParams.set('error', 'access_denied');
      if (body.state) location.searchParams.set('state', body.state);
      return reply.send({ location: location.toString() });
    }
  );

  // ---------------------------------------------------------------- Apps

  const oauthError = (reply: any, status: number, error: string, description: string) => reply.status(status).send({ error, error_description: description });

  async function issue(grantId: string, scopes: string[]) {
    const access = secret();
    const refresh = secret();
    const now = Date.now();
    await db.insert(oauthTokens).values([
      { tokenHash: sha(access), grantId, kind: 'access', scopes, expiresAt: new Date(now + ACCESS_TTL_S * 1000) },
      { tokenHash: sha(refresh), grantId, kind: 'refresh', scopes, expiresAt: new Date(now + REFRESH_TTL_S * 1000) },
    ]);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(' ') };
  }

  /** The client authenticates with HTTP Basic or client_id/client_secret in the body. */
  async function client(request: FastifyRequest, body: Record<string, string>) {
    let id = body.client_id;
    let sec = body.client_secret;
    const basic = /^Basic (.+)$/.exec(String(request.headers.authorization ?? ''));
    if (basic) [id, sec] = Buffer.from(basic[1], 'base64').toString().split(':');
    if (!isId(id) || typeof sec !== 'string') return null;
    const [row] = await db.select().from(oauthApps).where(eq(oauthApps.id, id)).limit(1);
    if (!row) return null;
    const a = Buffer.from(sha(sec));
    const b = Buffer.from(row.clientSecretHash);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? row : null;
  }

  app.post('/oauth2/token', { config: { public: true } }, async (request, reply) => {
    if (!db || !redis()) return oauthError(reply, 503, 'temporarily_unavailable', 'Try again later');
    reply.header('Cache-Control', 'no-store');
    const body = (request.body ?? {}) as Record<string, string>;
    const appRow = await client(request, body);
    if (!appRow) return oauthError(reply, 401, 'invalid_client', 'Client authentication failed');

    if (body.grant_type === 'authorization_code') {
      if (typeof body.code !== 'string') return oauthError(reply, 400, 'invalid_request', 'code is required');
      const key = `oauth:code:${sha(body.code)}`;
      // Single use: take it out before anything else.
      const raw = await redis().getdel(key);
      if (!raw) return oauthError(reply, 400, 'invalid_grant', 'The code is invalid, used or expired');
      // redirectUri is null for an Activity's code (sdk.authorize: nothing was redirected), and the
      // request must then leave redirect_uri out, as RFC 6749 §4.1.3 has it.
      const c = JSON.parse(raw) as { appId: string; transmitterId: string; scopes: string[]; redirectUri: string | null; challenge: string | null };
      if (c.appId !== appRow.id || (c.redirectUri ?? undefined) !== (body.redirect_uri || undefined)) return oauthError(reply, 400, 'invalid_grant', 'The code was issued to another client or redirect URI');
      if (c.challenge && crypto.createHash('sha256').update(String(body.code_verifier ?? '')).digest('base64url') !== c.challenge) {
        return oauthError(reply, 400, 'invalid_grant', 'code_verifier does not match');
      }
      const [grant] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.appId, appRow.id), eq(oauthGrants.transmitterId, c.transmitterId))).limit(1);
      if (!grant) return oauthError(reply, 400, 'invalid_grant', 'The authorization was revoked');
      return reply.send(await issue(grant.id, c.scopes));
    }

    if (body.grant_type === 'refresh_token') {
      if (typeof body.refresh_token !== 'string') return oauthError(reply, 400, 'invalid_request', 'refresh_token is required');
      const [tok] = await db
        .select({ hash: oauthTokens.tokenHash, expiresAt: oauthTokens.expiresAt, kind: oauthTokens.kind, scopes: oauthTokens.scopes, grant: oauthGrants })
        .from(oauthTokens)
        .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
        .where(eq(oauthTokens.tokenHash, sha(body.refresh_token)))
        .limit(1);
      if (!tok || tok.kind !== 'refresh' || tok.grant.appId !== appRow.id || new Date(tok.expiresAt) < new Date()) return oauthError(reply, 400, 'invalid_grant', 'The refresh token is invalid or expired');
      // Rotate: the old refresh token stops working.
      await db.delete(oauthTokens).where(eq(oauthTokens.tokenHash, tok.hash));
      // A refreshed token keeps what was consented to for it, never more (and never more than the grant still holds).
      return reply.send(await issue(tok.grant.id, (tok.scopes ?? tok.grant.scopes).filter((s: string) => tok.grant.scopes.includes(s))));
    }

    return oauthError(reply, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
  });

  app.post('/oauth2/token/revoke', { config: { public: true } }, async (request, reply) => {
    if (!db) return oauthError(reply, 503, 'temporarily_unavailable', 'Try again later');
    const body = (request.body ?? {}) as Record<string, string>;
    const appRow = await client(request, body);
    if (!appRow) return oauthError(reply, 401, 'invalid_client', 'Client authentication failed');
    if (typeof body.token === 'string') {
      const [tok] = await db.select({ hash: oauthTokens.tokenHash, appId: oauthGrants.appId }).from(oauthTokens).innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId)).where(eq(oauthTokens.tokenHash, sha(body.token))).limit(1);
      if (tok?.appId === appRow.id) await db.delete(oauthTokens).where(eq(oauthTokens.tokenHash, tok.hash));
    }
    // RFC 7009: the same answer whether or not the token existed.
    return reply.status(200).send({});
  });

  /** The grant behind an app's bearer token, or null. */
  async function bearer(request: FastifyRequest, scope?: string) {
    const m = /^Bearer (.+)$/.exec(String(request.headers.authorization ?? ''));
    if (!m) return null;
    const [tok] = await db
      .select({ expiresAt: oauthTokens.expiresAt, kind: oauthTokens.kind, tokenScopes: oauthTokens.scopes, grant: oauthGrants, app: oauthApps })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
      .innerJoin(oauthApps, eq(oauthApps.id, oauthGrants.appId))
      .where(eq(oauthTokens.tokenHash, sha(m[1])))
      .limit(1);
    if (!tok || tok.kind !== 'access' || new Date(tok.expiresAt) < new Date()) return null;
    const scopes: string[] = (tok.tokenScopes ?? tok.grant.scopes).filter((s: string) => tok.grant.scopes.includes(s));
    if (scope && !scopes.includes(scope)) return { ...tok, scopes, forbidden: true };
    await db.update(oauthGrants).set({ lastUsedAt: new Date() }).where(eq(oauthGrants.id, tok.grant.id));
    return { ...tok, scopes, forbidden: false };
  }

  app.get('/oauth2/@me', { config: { public: true } }, async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const tok = await bearer(request);
    if (!tok) return reply.status(401).send({ error: 'Invalid or expired token' });
    const scopes = tok.scopes;
    const [u] = await db.select().from(transmitters).where(eq(transmitters.id, tok.grant.transmitterId)).limit(1);
    return reply.send({
      application: { id: tok.app.id, name: tok.app.name },
      scopes,
      expires: tok.expiresAt,
      user: scopes.includes('identify')
        ? { id: u.id, username: u.username, discriminator: u.discriminator, displayName: u.displayName, avatarUrl: u.avatarUrl, ...(scopes.includes('email') ? { email: u.email, verified: !!u.isEmailVerified && emailVerificationEnabled() } : {}) }
        : undefined,
    });
  });

  app.get('/oauth2/@me/beacons', { config: { public: true } }, async (request, reply) => {
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const tok = await bearer(request, 'beacons');
    if (!tok) return reply.status(401).send({ error: 'Invalid or expired token' });
    if (tok.forbidden) return reply.status(403).send({ error: 'The beacons scope was not granted' });
    const me = tok.grant.transmitterId;
    const ids = (await db.select({ id: beaconMembers.beaconId }).from(beaconMembers).where(eq(beaconMembers.transmitterId, me))).map((r: any) => r.id);
    const rows = ids.length ? await db.select().from(beacons).where(inArray(beacons.id, ids)) : [];
    return reply.send({ beacons: rows.map((b: any) => ({ id: b.id, name: b.name, iconUrl: b.iconUrl, owner: b.ownerId === me })) });
  });

  // ---------------------------------------------------------------- Authorized Apps

  app.get('/users/@me/oauth2/grants', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const rows = await db
      .select({ grant: oauthGrants, app: oauthApps, owner: transmitters.username })
      .from(oauthGrants)
      .innerJoin(oauthApps, eq(oauthApps.id, oauthGrants.appId))
      .innerJoin(transmitters, eq(transmitters.id, oauthApps.ownerId))
      .where(eq(oauthGrants.transmitterId, token.transmitterId))
      .orderBy(oauthGrants.createdAt);
    return reply.send({
      grants: rows.map((r: any) => ({
        id: r.grant.id,
        scopes: r.grant.scopes,
        createdAt: r.grant.createdAt,
        lastUsedAt: r.grant.lastUsedAt,
        application: { id: r.app.id, name: r.app.name, description: r.app.description, iconUrl: r.app.iconUrl, owner: r.owner },
      })),
    });
  });

  app.delete('/users/@me/oauth2/grants/:id', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const { id } = request.params as { id: string };
    if (!isId(id)) return reply.status(404).send({ error: 'Not found' });
    // Its tokens go with it (cascade), so the app is cut off at once.
    await db.delete(oauthGrants).where(and(eq(oauthGrants.id, id), eq(oauthGrants.transmitterId, token.transmitterId)));
    return reply.status(204).send();
  });
};
