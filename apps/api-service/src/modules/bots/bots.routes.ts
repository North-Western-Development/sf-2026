import crypto from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, inArray, appBots, oauthApps, transmitters, beaconMembers, clearances, beacons, loadDeveloperPolicy, accountVerification } from '@subspace/database';
import { type AppRole, appRoleAtLeast, PERMISSIONS, PRIVILEGED_INTENT_INFO, hasPermission, mayUseIntent, verifiedMeans } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { createAppUser, renameAppUser, newSecret, hashSecret, sealSecret } from '../../lib/app-users.js';
import { forgetBotTokens } from '../../lib/bot-auth.js';
import { revokeSessions } from '../../lib/sessions.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';
import { buildMember } from '../../lib/members.js';
import { audit } from '../../lib/audit.js';
import { isSafeOutboundUrl } from '../../lib/interactions.js';
import { appRole, appWithRole } from '../../lib/app-access.js';

/** A bot token: the bot's id (so it can be told apart at a glance) and a secret. */
const botToken = (userId: string) => `${Buffer.from(userId).toString('base64url')}.${newSecret()}`;

/**
 * Bots (Discord's): a Developer Application can have one. It signs in with `Authorization: Bot
 * <token>` (see lib/bot-auth.ts), joins beacons when someone with Manage Beacon adds it, and gets a
 * clearance of its own holding the permissions it asked for.
 *   GET    /applications/:id/bot                 the owner's view (never the token)
 *   POST   /applications/:id/bot                 create it: the token is in the answer, once
 *   PATCH  /applications/:id/bot                 { isPublic?, messageContent?, activityIntent?, interactionsUrl? }
 *   POST   /applications/:id/bot/reset-token
 *   DELETE /applications/:id/bot                 it leaves every beacon
 *   GET    /bots/@me                             the bot itself
 *   GET    /beacons/:id/bots                     bots in a beacon
 *   POST   /beacons/:id/bots                     { appId, permissions }  Manage Beacon
 *   DELETE /beacons/:id/bots/:appId              Manage Beacon or Kick Members
 */
export const botRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /** The application in the URL and its bot, if the caller has at least `needed` on it (owner or team role). */
  async function ownedApp(request: any, reply: any, needed: AppRole = 'developer') {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    if ((token as any).bot) return reply.status(403).send({ error: 'Bots cannot manage applications', code: 'BOT_FORBIDDEN' }), null;
    const { id } = request.params as { id: string };
    const found = await appWithRole(db, id, token.transmitterId, needed);
    if (found.error === 404) return reply.status(404).send({ error: 'Unknown application', code: 'UNKNOWN_APPLICATION' }), null;
    if (found.error === 403) return reply.status(403).send({ error: 'Your team role does not allow that', code: 'TEAM_ROLE_TOO_LOW' }), null;
    const row = found.app;
    const [bot] = await db.select().from(appBots).where(eq(appBots.appId, row.id)).limit(1);
    return { me: token.transmitterId as string, app: row, bot: bot ?? null };
  }
  const botView = (b: any, token?: string) => ({
    userId: b.userId,
    isPublic: b.isPublic,
    messageContent: b.messageContent,
    activityIntent: b.activityIntent,
    interactionsUrl: b.interactionsUrl,
    publicKey: b.publicKey,
    ...(token ? { token } : {}),
  });

  app.get('/applications/:id/bot', { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } } } }, async (request, reply) => {
    const ctx = await ownedApp(request, reply, 'read_only');
    if (!ctx) return;
    return reply.send({ bot: ctx.bot ? botView(ctx.bot) : null });
  });

  app.post('/applications/:id/bot', { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } } } }, async (request, reply) => {
    const ctx = await ownedApp(request, reply);
    if (!ctx) return;
    if (ctx.bot) return reply.status(409).send({ error: 'This application already has a bot', code: 'BOT_EXISTS' });
    const userId = await createAppUser(db, 'bot', ctx.app.name, ctx.app.iconUrl ?? null);
    const token = botToken(userId);
    // The key that signs interaction requests: the developer checks them with the public half.
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    const [bot] = await db
      .insert(appBots)
      .values({ appId: ctx.app.id, userId, tokenHash: hashSecret(token), publicKey: pub, privateKeyEnc: sealSecret(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()) })
      .returning();
    return reply.status(201).send({ bot: botView(bot, token) });
  });

  app.patch(
    '/applications/:id/bot',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { isPublic: { type: 'boolean' }, messageContent: { type: 'boolean' }, activityIntent: { type: 'boolean' }, interactionsUrl: { type: ['string', 'null'], maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      const ctx = await ownedApp(request, reply);
      if (!ctx) return;
      if (!ctx.bot) return reply.status(404).send({ error: 'This application has no bot', code: 'NO_BOT' });
      const body = request.body as { isPublic?: boolean; messageContent?: boolean; activityIntent?: boolean; interactionsUrl?: string | null };
      // Privileged intents the instance keeps for verified developers (Command Console › Developers).
      const turningOn = ([['messageContent', body.messageContent], ['activity', body.activityIntent]] as const).filter(([, v]) => v === true).map(([k]) => k);
      if (turningOn.length) {
        const [policy, me] = await Promise.all([loadDeveloperPolicy(db), accountVerification(db, ctx.me)]);
        const refused = turningOn.find((intent) => !mayUseIntent(me, policy, intent));
        if (refused) return reply.status(403).send({ error: `The ${PRIVILEGED_INTENT_INFO[refused].label} intent needs a verified account here: ${verifiedMeans(policy)}`, code: 'INTENT_RESTRICTED' });
      }
      if (body.interactionsUrl) {
        // Interactions are delivered there by the server: never to a private address.
        if (!(await isSafeOutboundUrl(body.interactionsUrl))) return reply.status(400).send({ error: 'Use a public https:// address', code: 'INVALID_INTERACTIONS_URL' });
      }
      const [bot] = await db
        .update(appBots)
        .set({ ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}), ...(body.messageContent !== undefined ? { messageContent: body.messageContent } : {}), ...(body.activityIntent !== undefined ? { activityIntent: body.activityIntent } : {}), ...(body.interactionsUrl !== undefined ? { interactionsUrl: body.interactionsUrl || null } : {}) })
        .where(eq(appBots.appId, ctx.app.id))
        .returning();
      await renameAppUser(db, bot.userId, ctx.app.name, ctx.app.iconUrl ?? null);
      // A connected bot gets (or loses) the intents straight away.
      if (body.messageContent !== undefined || body.activityIntent !== undefined) await publishSessionRefresh(app, [bot.userId]);
      return reply.send({ bot: botView(bot) });
    }
  );

  app.post('/applications/:id/bot/reset-token', { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } } } }, async (request, reply) => {
    const ctx = await ownedApp(request, reply);
    if (!ctx) return;
    if (!ctx.bot) return reply.status(404).send({ error: 'This application has no bot', code: 'NO_BOT' });
    const token = botToken(ctx.bot.userId);
    const [bot] = await db.update(appBots).set({ tokenHash: hashSecret(token) }).where(eq(appBots.appId, ctx.app.id)).returning();
    await forgetBotTokens((app as any).redis);
    // Connections opened with the old token close now, not when they next reconnect.
    await revokeSessions(app, ctx.bot.userId);
    return reply.send({ bot: botView(bot, token) });
  });

  app.delete('/applications/:id/bot', { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } } } } }, async (request, reply) => {
    const ctx = await ownedApp(request, reply, 'admin');
    if (!ctx) return;
    if (!ctx.bot) return reply.status(404).send({ error: 'This application has no bot', code: 'NO_BOT' });
    // Its account goes too: memberships and its clearances with it.
    await db.delete(clearances).where(eq(clearances.managedBy, ctx.bot.userId));
    await db.delete(transmitters).where(eq(transmitters.id, ctx.bot.userId));
    await forgetBotTokens((app as any).redis);
    await revokeSessions(app, ctx.bot.userId);
    return reply.send({ deleted: true });
  });

  app.get('/bots/@me', async (request, reply) => {
    const token = extractAuthToken(request) as any;
    if (!token?.bot) return reply.status(403).send({ error: 'Only for bots', code: 'NOT_A_BOT' });
    const [u] = await db.select({ id: transmitters.id, username: transmitters.username, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl }).from(transmitters).where(eq(transmitters.id, token.transmitterId)).limit(1);
    const beaconIds = (await db.select({ id: beaconMembers.beaconId }).from(beaconMembers).where(eq(beaconMembers.transmitterId, token.transmitterId))).map((r: any) => r.id);
    return reply.send({ bot: { ...u, appId: token.appId, beaconIds } });
  });

  // ------------------------------------------------------------------ In beacons

  app.get('/beacons/:id/bots', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { id: beaconId } = request.params as { id: string };
    if (!(await resolveBeaconActorContext(db, token.transmitterId, beaconId))) return reply.status(404).send({ error: 'Beacon not found' });
    const rows = await db
      .select({ appId: appBots.appId, userId: appBots.userId, name: oauthApps.name, iconUrl: oauthApps.iconUrl, description: oauthApps.description })
      .from(appBots)
      .innerJoin(oauthApps, eq(oauthApps.id, appBots.appId))
      .innerJoin(beaconMembers, and(eq(beaconMembers.transmitterId, appBots.userId), eq(beaconMembers.beaconId, beaconId)));
    return reply.send({ bots: rows });
  });

  app.post(
    '/beacons/:id/bots',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['appId'],
          properties: { appId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, permissions: { type: 'string', pattern: '^[0-9]{1,20}$' } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request) as any;
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (token.bot) return reply.status(403).send({ error: 'Bots cannot add bots', code: 'BOT_FORBIDDEN' });
      const { id: beaconId } = request.params as { id: string };
      const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
      if (!actor) return reply.status(404).send({ error: 'Beacon not found' });
      if (!actor.isOwner && !hasPermission(actor.effectivePermissions, PERMISSIONS.MANAGE_BEACON)) return reply.status(403).send({ error: 'Transmitter lacks MANAGE_BEACON clearance', code: 'MISSING_PERMISSIONS' });
      const body = request.body as { appId: string; permissions?: string };
      const [row] = await db.select({ bot: appBots, app: oauthApps }).from(appBots).innerJoin(oauthApps, eq(oauthApps.id, appBots.appId)).where(eq(appBots.appId, body.appId)).limit(1);
      if (!row) return reply.status(404).send({ error: 'Unknown bot', code: 'UNKNOWN_BOT' });
      // A private bot: only its developers (the owner, or its team as a developer or above) add it.
      if (!row.bot.isPublic && !appRoleAtLeast(await appRole(db, row.app, token.transmitterId), 'developer')) return reply.status(403).send({ error: 'Only its developers can add this bot', code: 'PRIVATE_BOT' });
      const permissions = BigInt(body.permissions ?? '0');
      // Nobody hands a bot more than they hold themselves.
      if (!actor.isOwner && !hasPermission(actor.effectivePermissions, PERMISSIONS.ADMINISTRATOR) && (permissions & ~actor.effectivePermissions) !== 0n) {
        return reply.status(403).send({ error: 'You cannot give a bot permissions you do not have', code: 'FORBIDDEN_PERMISSION_GRANT' });
      }
      const [existing] = await db.select().from(beaconMembers).where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, row.bot.userId))).limit(1);
      if (existing) return reply.status(409).send({ error: 'That bot is already here', code: 'BOT_ALREADY_MEMBER' });
      const [clearance] = await db
        .insert(clearances)
        .values({ beaconId, name: row.app.name.slice(0, 100), color: '#99AAB5', position: 1, permissions, managedBy: row.bot.userId })
        .returning();
      await db.insert(beaconMembers).values({ beaconId, transmitterId: row.bot.userId, clearanceIds: [clearance.id], joinMethod: 'bot', invitedBy: token.transmitterId, hasCompletedOnboarding: true });
      await audit(db, { beaconId, actorId: token.transmitterId, action: 'bot_add', targetType: 'transmitter', targetId: row.bot.userId, targetName: row.app.name });
      await publishGatewayEvent(app, 'CLEARANCE_CREATE', { beaconId, clearance: { ...clearance, permissions: clearance.permissions.toString() } }, { beaconId });
      await publishGatewayEvent(app, 'MEMBER_ADD', { beaconId, member: await buildMember(db, (app as any).redis, beaconId, row.bot.userId) }, { beaconId });
      // The bot's own connection learns about the beacon.
      await publishGatewayEvent(app, 'BEACON_CREATE', { beacon: (await db.select().from(beacons).where(eq(beacons.id, beaconId)).limit(1))[0] }, { transmitterIds: [row.bot.userId] });
      await publishSessionRefresh(app, [row.bot.userId]);
      return reply.status(201).send({ added: true, userId: row.bot.userId, clearanceId: clearance.id });
    }
  );

  app.delete('/beacons/:id/bots/:appId', async (request, reply) => {
    const token = extractAuthToken(request) as any;
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { id: beaconId, appId } = request.params as { id: string; appId: string };
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return reply.status(404).send({ error: 'Beacon not found' });
    const [bot] = await db.select().from(appBots).where(eq(appBots.appId, appId)).limit(1);
    // A bot may leave by itself.
    const self = token.bot && bot?.userId === token.transmitterId;
    if (!self && !actor.isOwner && !hasPermission(actor.effectivePermissions, PERMISSIONS.MANAGE_BEACON) && !hasPermission(actor.effectivePermissions, PERMISSIONS.KICK_MEMBERS)) {
      return reply.status(403).send({ error: 'Transmitter lacks KICK_MEMBERS clearance', code: 'MISSING_PERMISSIONS' });
    }
    if (!bot) return reply.status(404).send({ error: 'Unknown bot', code: 'UNKNOWN_BOT' });
    await removeBotFromBeacon(app, beaconId, bot.userId);
    await audit(db, { beaconId, actorId: token.transmitterId, action: 'bot_remove', targetType: 'transmitter', targetId: bot.userId });
    return reply.send({ removed: true });
  });
};

/** A bot leaves a beacon: its membership and the clearance made for it go. */
export async function removeBotFromBeacon(app: FastifyInstance, beaconId: string, botUserId: string) {
  const db = (app as any).db;
  const managed = await db.select({ id: clearances.id }).from(clearances).where(and(eq(clearances.beaconId, beaconId), eq(clearances.managedBy, botUserId)));
  await db.delete(beaconMembers).where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, botUserId)));
  if (managed.length) await db.delete(clearances).where(inArray(clearances.id, managed.map((c: any) => c.id)));
  await publishGatewayEvent(app, 'MEMBER_REMOVE', { beaconId, transmitterId: botUserId, userId: botUserId }, { beaconId });
  // The bot is no longer a member, so it does not get that: tell it the beacon is gone for it.
  await publishGatewayEvent(app, 'BEACON_DELETE', { id: beaconId, unavailable: false }, { transmitterIds: [botUserId] });
  await publishSessionRefresh(app, [botUserId]);
  for (const c of managed) await publishGatewayEvent(app, 'CLEARANCE_DELETE', { beaconId, clearanceId: c.id }, { beaconId });
}
