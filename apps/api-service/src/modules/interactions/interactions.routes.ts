import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { appRole } from '../../lib/app-access.js';
import { appRoleAtLeast } from '@subspace/constants';
import { and, eq, isNull, or, inArray, appBots, appCommands, oauthApps, beaconMembers, transmitters, relays, clearances, computeRelayPermissions, newSnowflake, type CommandOption } from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { loadChannel, checkChannelAccess } from '../../lib/channels.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { hashSecret, newSecret } from '../../lib/app-users.js';
import { RICH_EMBEDS_SCHEMA } from '../../lib/rich-embeds.js';
import { EmbedError } from '../../lib/rich-embeds.js';
import {
  RESPONSE_DEADLINE_MS,
  deliverReply,
  editOriginal,
  loadInteraction,
  postToEndpoint,
  saveInteraction,
  type InteractionReply,
  type InteractionState,
} from '../../lib/interactions.js';

const NAME_RE = '^[a-z0-9_-]{1,32}$';
const OPTION_TYPES = ['string', 'integer', 'number', 'boolean', 'user', 'relay', 'clearance'];
const COMMAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description'],
  properties: {
    name: { type: 'string', pattern: NAME_RE },
    description: { type: 'string', minLength: 1, maxLength: 100 },
    defaultMemberPermissions: { type: ['string', 'null'], pattern: '^[0-9]{1,20}$' },
    options: {
      type: 'array',
      maxItems: 25,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'name', 'description'],
        properties: {
          type: { type: 'string', enum: OPTION_TYPES },
          name: { type: 'string', pattern: NAME_RE },
          description: { type: 'string', minLength: 1, maxLength: 100 },
          required: { type: 'boolean' },
          choices: {
            type: 'array',
            maxItems: 25,
            items: { type: 'object', additionalProperties: false, required: ['name', 'value'], properties: { name: { type: 'string', maxLength: 100 }, value: { type: ['string', 'number'] } } },
          },
        },
      },
    },
  },
} as const;
const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { content: { type: 'string', maxLength: 2000 }, embeds: RICH_EMBEDS_SCHEMA, ephemeral: { type: 'boolean' } },
} as const;

/**
 * Slash commands and interactions (Discord's application commands):
 *   GET|PUT /applications/:appId/commands                     global commands (the bot, or the app's owner)
 *   GET|PUT /applications/:appId/beacons/:beaconId/commands   one beacon's
 *   GET     /beacons/:beaconId/commands?relayId=              what the caller may use there
 *   POST    /interactions                                     { commandId, channelType, channelId, options }
 *   POST    /interactions/:id/:token/callback                 { type: 4 reply | 5 thinking, data }
 *   POST    /interactions/:id/:token/followup                 another message (15 minutes)
 *   PATCH   /interactions/:id/:token/original                 edit the reply
 * Interactions reach the bot by a signed POST to its endpoint (it may answer in the response) or
 * as INTERACTION_CREATE on its gateway connection; either way it has 3 seconds to answer.
 */
export const interactionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const redis = () => {
    const r = (app as any).redis;
    return r?.status === 'ready' ? r : null;
  };

  // ------------------------------------------------------------------ Registering commands

  /** The app, when the caller is its bot, or its developers (the owner, or its team: reading needs Read-only, changing Developer). */
  async function appFor(request: any, reply: any) {
    const token = extractAuthToken(request) as any;
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    const { appId } = request.params as { appId: string };
    const [row] = await db.select({ app: oauthApps, bot: appBots }).from(oauthApps).leftJoin(appBots, eq(appBots.appId, oauthApps.id)).where(eq(oauthApps.id, appId)).limit(1);
    const mine = row && (token.bot ? token.appId === appId : appRoleAtLeast(await appRole(db, row.app, token.transmitterId), request.method === 'GET' ? 'read_only' : 'developer'));
    if (!mine) return reply.status(404).send({ error: 'Unknown application', code: 'UNKNOWN_APPLICATION' }), null;
    if (!row.bot) return reply.status(400).send({ error: 'Add a bot to the application first', code: 'NO_BOT' }), null;
    return row as { app: any; bot: any };
  }
  const commandView = (c: any) => ({
    id: c.id,
    appId: c.appId,
    beaconId: c.beaconId,
    name: c.name,
    description: c.description,
    options: c.options,
    defaultMemberPermissions: c.defaultMemberPermissions?.toString() ?? null,
  });
  async function overwrite(appId: string, beaconId: string | null, list: any[]) {
    const names = new Set(list.map((c) => c.name));
    if (names.size !== list.length) throw new Error('Command names must be different');
    const scope = beaconId ? eq(appCommands.beaconId, beaconId) : isNull(appCommands.beaconId);
    const existing = await db.select().from(appCommands).where(and(eq(appCommands.appId, appId), scope));
    // Keep each command's id across overwrites, so clients and bots can rely on it.
    const keep = new Map(existing.map((c: any) => [c.name, c]));
    const gone = existing.filter((c: any) => !names.has(c.name)).map((c: any) => c.id);
    if (gone.length) await db.delete(appCommands).where(inArray(appCommands.id, gone));
    const out = [];
    for (const c of list) {
      const values = {
        description: c.description,
        options: (c.options ?? []) as CommandOption[],
        defaultMemberPermissions: c.defaultMemberPermissions ? BigInt(c.defaultMemberPermissions) : null,
      };
      const prev = keep.get(c.name) as any;
      const [row] = prev
        ? await db.update(appCommands).set(values).where(eq(appCommands.id, prev.id)).returning()
        : await db.insert(appCommands).values({ appId, beaconId, name: c.name, ...values }).returning();
      out.push(commandView(row));
    }
    return out;
  }

  app.get('/applications/:appId/commands', async (request, reply) => {
    const ctx = await appFor(request, reply);
    if (!ctx) return;
    const rows = await db.select().from(appCommands).where(and(eq(appCommands.appId, ctx.app.id), isNull(appCommands.beaconId)));
    return reply.send({ commands: rows.map(commandView) });
  });
  app.put('/applications/:appId/commands', { schema: { body: { type: 'array', maxItems: 100, items: COMMAND_SCHEMA } } }, async (request, reply) => {
    const ctx = await appFor(request, reply);
    if (!ctx) return;
    try {
      return reply.send({ commands: await overwrite(ctx.app.id, null, request.body as any[]) });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'INVALID_COMMANDS' });
    }
  });
  app.get('/applications/:appId/beacons/:beaconId/commands', async (request, reply) => {
    const ctx = await appFor(request, reply);
    if (!ctx) return;
    const { beaconId } = request.params as { beaconId: string };
    const rows = await db.select().from(appCommands).where(and(eq(appCommands.appId, ctx.app.id), eq(appCommands.beaconId, beaconId)));
    return reply.send({ commands: rows.map(commandView) });
  });
  app.put('/applications/:appId/beacons/:beaconId/commands', { schema: { body: { type: 'array', maxItems: 100, items: COMMAND_SCHEMA } } }, async (request, reply) => {
    const ctx = await appFor(request, reply);
    if (!ctx) return;
    const { beaconId } = request.params as { beaconId: string };
    const [inBeacon] = await db.select().from(beaconMembers).where(and(eq(beaconMembers.beaconId, beaconId), eq(beaconMembers.transmitterId, ctx.bot.userId))).limit(1);
    if (!inBeacon) return reply.status(403).send({ error: 'The bot is not in that beacon', code: 'BOT_NOT_MEMBER' });
    try {
      return reply.send({ commands: await overwrite(ctx.app.id, beaconId, request.body as any[]) });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message, code: 'INVALID_COMMANDS' });
    }
  });

  // ------------------------------------------------------------------ Using them

  /** Commands of the bots in a beacon that the caller may use (in that relay, when given). */
  async function usableCommands(userId: string, beaconId: string, relayId?: string) {
    const actor = await resolveBeaconActorContext(db, userId, beaconId);
    if (!actor) return null;
    const perms = relayId ? await computeRelayPermissions(db, userId, relayId) : actor.effectivePermissions;
    if (!hasPermission(perms, PERMISSIONS.USE_APPLICATION_COMMANDS)) return [];
    const bots = await db
      .select({ appId: appBots.appId, userId: appBots.userId, name: oauthApps.name, iconUrl: oauthApps.iconUrl })
      .from(appBots)
      .innerJoin(oauthApps, eq(oauthApps.id, appBots.appId))
      .innerJoin(beaconMembers, and(eq(beaconMembers.transmitterId, appBots.userId), eq(beaconMembers.beaconId, beaconId)));
    if (!bots.length) return [];
    const rows = await db
      .select()
      .from(appCommands)
      .where(and(inArray(appCommands.appId, bots.map((b: any) => b.appId)), or(isNull(appCommands.beaconId), eq(appCommands.beaconId, beaconId))));
    const byApp = new Map(bots.map((b: any) => [b.appId, b]));
    return rows
      .filter((c: any) => !c.defaultMemberPermissions || hasPermission(perms, c.defaultMemberPermissions))
      .map((c: any) => ({ ...commandView(c), app: { id: c.appId, name: (byApp.get(c.appId) as any).name, iconUrl: (byApp.get(c.appId) as any).iconUrl, botUserId: (byApp.get(c.appId) as any).userId } }));
  }

  app.get('/beacons/:beaconId/commands', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    const { beaconId } = request.params as { beaconId: string };
    const { relayId } = request.query as { relayId?: string };
    const list = await usableCommands(token.transmitterId, beaconId, relayId);
    if (!list) return reply.status(404).send({ error: 'Beacon not found' });
    return reply.send({ commands: list });
  });

  /** Option values checked against the command's options: types, choices, required. */
  async function checkOptions(defs: CommandOption[], given: Record<string, unknown>, beaconId: string) {
    const out: Array<{ name: string; type: string; value: unknown }> = [];
    for (const d of defs) {
      const raw = given[d.name];
      if (raw === undefined || raw === null || raw === '') {
        if (d.required) throw new Error(`${d.name} is required`);
        continue;
      }
      let value: unknown = raw;
      if (d.type === 'integer' || d.type === 'number') {
        value = Number(raw);
        if (!Number.isFinite(value as number) || (d.type === 'integer' && !Number.isInteger(value))) throw new Error(`${d.name} must be a ${d.type}`);
      } else if (d.type === 'boolean') {
        value = raw === true || raw === 'true';
      } else if (d.type === 'user' || d.type === 'relay' || d.type === 'clearance') {
        const id = String(raw).replace(/^<[@#&]*|>$/g, '');
        const table = d.type === 'user' ? beaconMembers : d.type === 'relay' ? relays : clearances;
        const idCol = d.type === 'user' ? beaconMembers.transmitterId : d.type === 'relay' ? relays.id : clearances.id;
        const [hit] = /^[1-9][0-9]{0,18}$/.test(id) ? await db.select().from(table as any).where(and(eq(idCol as any, id), eq((table as any).beaconId, beaconId))).limit(1) : [];
        if (!hit) throw new Error(`${d.name} must be a ${d.type} in this beacon`);
        value = id;
      } else {
        value = String(raw).slice(0, 6000);
      }
      if (d.choices?.length && !d.choices.some((c) => c.value === value)) throw new Error(`${d.name} must be one of its choices`);
      out.push({ name: d.name, type: d.type, value });
    }
    return out;
  }

  app.post(
    '/interactions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['commandId', 'channelType', 'channelId'],
          properties: {
            commandId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
            channelType: { type: 'string', enum: ['relay', 'thread'] },
            channelId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
            options: { type: 'object', maxProperties: 25 },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request) as any;
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (token.bot) return reply.status(403).send({ error: 'Bots cannot use commands', code: 'BOT_FORBIDDEN' });
      if (!db || !redis()) return reply.status(503).send({ error: 'Commands are unavailable right now' });
      const body = request.body as { commandId: string; channelType: 'relay' | 'thread'; channelId: string; options?: Record<string, unknown> };
      const channel = await loadChannel(db, body.channelType, body.channelId);
      if (!channel?.beaconId) return reply.status(404).send({ error: 'Channel not found' });
      const access = await checkChannelAccess(db, channel, token.transmitterId, 'view');
      if (!access.allowed) return reply.status(access.status).send({ error: access.error });
      const usable = await usableCommands(token.transmitterId, channel.beaconId, channel.relayId);
      const command = usable?.find((c: any) => c.id === body.commandId);
      if (!command) return reply.status(403).send({ error: 'You cannot use that command here', code: 'COMMAND_UNAVAILABLE' });
      // The bot must be able to answer there.
      const botPerms = await computeRelayPermissions(db, command.app.botUserId, channel.relayId!);
      if (!hasPermission(botPerms, PERMISSIONS.VIEW_RELAY) || !hasPermission(botPerms, PERMISSIONS.SEND_TRANSMISSIONS)) {
        return reply.status(403).send({ error: `${command.app.name} cannot post here`, code: 'BOT_CANNOT_POST' });
      }
      let options;
      try {
        options = await checkOptions(command.options, body.options ?? {}, channel.beaconId);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message, code: 'INVALID_OPTION' });
      }
      const [bot] = await db.select().from(appBots).where(eq(appBots.appId, command.appId)).limit(1);
      const [user] = await db.select({ id: transmitters.id, username: transmitters.username, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl }).from(transmitters).where(eq(transmitters.id, token.transmitterId)).limit(1);
      const secret = newSecret();
      const state: InteractionState = {
        id: newSnowflake(),
        tokenHash: hashSecret(secret),
        appId: command.appId,
        botUserId: bot.userId,
        userId: token.transmitterId,
        beaconId: channel.beaconId,
        channelType: body.channelType,
        channelId: body.channelId,
        commandName: command.name,
        createdAt: Date.now(),
        responded: false,
        deferred: false,
        ephemeral: false,
        originalId: null,
      };
      await saveInteraction(redis(), state);
      const payload = {
        type: 2,
        id: state.id,
        token: secret,
        applicationId: command.appId,
        beaconId: channel.beaconId,
        channel: { type: body.channelType, id: body.channelId },
        user,
        memberPermissions: (access.actorContext?.effectivePermissions ?? 0n).toString(),
        data: { id: command.id, name: command.name, options },
      };
      // Answer the person now; the bot's reply arrives as an event.
      reply.status(202).send({ interaction: { id: state.id, command: command.name, app: command.app.name } });
      void dispatch(state, bot, payload, secret).catch((err) => app.log.warn({ err: (err as Error).message }, 'interaction delivery failed'));
    }
  );

  /** Hand the interaction to the bot, then give up after 3 seconds without an answer. */
  async function dispatch(state: InteractionState, bot: any, payload: unknown, secret: string) {
    if (bot.interactionsUrl) {
      const answer = await postToEndpoint(bot.interactionsUrl, bot.privateKeyEnc, payload).catch(() => null);
      if (answer && (answer.type === 4 || answer.type === 5)) await respond(state.id, secret, answer.type, answer.data ?? {});
    } else {
      await publishGatewayEvent(app, 'INTERACTION_CREATE', payload as Record<string, unknown>, { transmitterIds: [bot.userId] });
    }
    setTimeout(() => {
      void (async () => {
        const now = await loadInteraction(redis(), state.id);
        if (now && !now.responded) {
          await publishGatewayEvent(app, 'INTERACTION_FAILED', { interactionId: state.id, channelType: state.channelType, channelId: state.channelId, error: 'The application did not respond' }, { transmitterIds: [state.userId] });
        }
      })().catch(() => undefined);
    }, RESPONSE_DEADLINE_MS + 250);
  }

  /** The bot's first answer: a reply now (4), or "thinking" with the reply to follow (5). */
  async function respond(id: string, token: string, type: number, data: InteractionReply) {
    const r = redis();
    const s = await loadInteraction(r, id, token);
    if (!s) throw Object.assign(new Error('Unknown interaction'), { status: 404, code: 'UNKNOWN_INTERACTION' });
    if (s.responded) throw Object.assign(new Error('This interaction was already answered'), { status: 400, code: 'ALREADY_RESPONDED' });
    if (Date.now() - s.createdAt > RESPONSE_DEADLINE_MS + 500) throw Object.assign(new Error('Too late: answer within 3 seconds, or defer'), { status: 400, code: 'RESPONSE_TOO_LATE' });
    s.responded = true;
    s.ephemeral = !!data.ephemeral;
    if (type === 5) {
      s.deferred = true;
      await publishGatewayEvent(app, 'INTERACTION_DEFERRED', { interactionId: s.id, channelType: s.channelType, channelId: s.channelId, appUserId: s.botUserId, command: s.commandName }, { transmitterIds: [s.userId] });
    } else {
      await deliverReply(app, s, data, { asOriginal: true });
    }
    await saveInteraction(r, s);
  }

  const failure = (reply: any, err: any) => {
    if (err instanceof EmbedError) return reply.status(400).send({ error: err.message, code: 'EMBED_TOO_LARGE' });
    return reply.status(err.status ?? 400).send({ error: err.message, code: err.code ?? 'INVALID_REPLY' });
  };

  app.post(
    '/interactions/:id/:token/callback',
    {
      config: { public: true },
      schema: { body: { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { type: 'integer', enum: [4, 5] }, data: REPLY_SCHEMA } } },
    },
    async (request, reply) => {
      if (!db || !redis()) return reply.status(503).send({ error: 'Unavailable' });
      const { id, token } = request.params as { id: string; token: string };
      const body = request.body as { type: 4 | 5; data?: InteractionReply };
      try {
        await respond(id, token, body.type, body.data ?? {});
        return reply.status(204).send();
      } catch (err) {
        return failure(reply, err);
      }
    }
  );

  app.post('/interactions/:id/:token/followup', { config: { public: true }, schema: { body: REPLY_SCHEMA } }, async (request, reply) => {
    if (!db || !redis()) return reply.status(503).send({ error: 'Unavailable' });
    const { id, token } = request.params as { id: string; token: string };
    const s = await loadInteraction(redis(), id, token);
    if (!s) return reply.status(404).send({ error: 'Unknown or expired interaction', code: 'UNKNOWN_INTERACTION' });
    if (!s.responded) return reply.status(400).send({ error: 'Answer the interaction first', code: 'NOT_RESPONDED' });
    try {
      // After "thinking", the first follow-up is the reply itself.
      const first = s.deferred && !s.originalId;
      const sent = await deliverReply(app, s, { ...(request.body as InteractionReply), ephemeral: (request.body as InteractionReply).ephemeral ?? (first && s.ephemeral) }, { asOriginal: first });
      await saveInteraction(redis(), s);
      return reply.send({ transmission: sent });
    } catch (err) {
      return failure(reply, err);
    }
  });

  app.patch('/interactions/:id/:token/original', { config: { public: true }, schema: { body: REPLY_SCHEMA } }, async (request, reply) => {
    if (!db || !redis()) return reply.status(503).send({ error: 'Unavailable' });
    const { id, token } = request.params as { id: string; token: string };
    const s = await loadInteraction(redis(), id, token);
    if (!s) return reply.status(404).send({ error: 'Unknown or expired interaction', code: 'UNKNOWN_INTERACTION' });
    if (s.ephemeral) return reply.status(400).send({ error: 'Ephemeral replies cannot be edited', code: 'EPHEMERAL' });
    try {
      const sent = await editOriginal(app, s, request.body as InteractionReply);
      await saveInteraction(redis(), s);
      return reply.send({ transmission: sent });
    } catch (err) {
      return failure(reply, err);
    }
  });
};
