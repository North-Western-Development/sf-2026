import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { and, eq, desc, inArray, beaconMembers, beaconStickers, beacons, gifFavorites, relays, soundboardSounds, resolveRelayAudience } from '@subspace/database';
import { PERMISSIONS, hasPermission, canCreateExpressions, canEditExpression } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext, resolveRelayActorContext } from '../../middleware/hierarchy.js';
import { validateMediaUrl } from '../../lib/media.js';
import { publishGatewayEvent } from '../../lib/events.js';
import { audit } from '../../lib/audit.js';

/** Discord's caps for a server without boosts. */
const MAX_STICKERS = 30;
const MAX_SOUNDS = 24;
/** Built-in sounds every comm-link has (the client makes them; Discord's default sounds). */
export const DEFAULT_SOUNDS = ['ping', 'chime', 'drum', 'laser', 'cheer', 'boing'];

const STICKER_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 30 },
    description: { type: ['string', 'null'], maxLength: 100 },
    emoji: { type: 'string', minLength: 1, maxLength: 16 },
    url: { type: 'string', maxLength: 500 },
  },
};
const SOUND_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 32 },
    emoji: { type: ['string', 'null'], maxLength: 16 },
    url: { type: 'string', maxLength: 500 },
    volume: { type: 'integer', minimum: 0, maximum: 100 },
  },
};

/**
 * Expression (Discord's Stickers and Soundboard):
 *   GET|POST /beacons/:id/stickers, PATCH|DELETE /beacons/:id/stickers/:stickerId
 *   GET /users/@me/stickers        every sticker from the beacons you are in (for the picker)
 *   GET|POST /beacons/:id/sounds, PATCH|DELETE /beacons/:id/sounds/:soundId
 *   POST /relays/:relayId/soundboard  { soundId } or { defaultSound } — plays to the comm-link
 *   GET /gifs/trending, GET /gifs/search?q=   through GIPHY when GIPHY_API_KEY is set
 *   GET|POST /users/@me/gif-favorites, DELETE /users/@me/gif-favorites/:id
 */
export const expressionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  /** A member of the beacon; with `expressions`, one who may add them (Create or Manage Expressions). */
  async function member(request: any, reply: any, expressions = false) {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' }), null;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' }), null;
    const { id: beaconId } = request.params as { id: string };
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' }), null;
    if (expressions && !canCreateExpressions(actor.effectivePermissions)) return reply.status(403).send({ error: 'Transmitter lacks CREATE_EXPRESSIONS clearance', code: 'MISSING_PERMISSIONS' }), null;
    return { beaconId, actorId: token.transmitterId as string, perms: actor.effectivePermissions as bigint };
  }
  /** Someone else's sticker or sound needs Manage Expressions. */
  function mayEdit(ctx: { actorId: string; perms: bigint }, row: { creatorId: string | null } | undefined, reply: any) {
    if (!row) return reply.status(404).send({ error: 'Not found' }), false;
    if (!canEditExpression(ctx.perms, row.creatorId === ctx.actorId)) return reply.status(403).send({ error: 'Only its creator, or someone with Manage Expressions, can change it', code: 'MISSING_PERMISSIONS' }), false;
    return true;
  }

  const changed = (beaconId: string, kind: 'stickers' | 'sounds') => publishGatewayEvent(app, 'BEACON_EXPRESSIONS_UPDATE', { beaconId, kind }, { beaconId });

  // ------------------------------------------------------------------ Stickers

  app.get('/beacons/:id/stickers', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    return reply.send({ stickers: await db.select().from(beaconStickers).where(eq(beaconStickers.beaconId, ctx.beaconId)).orderBy(beaconStickers.createdAt) });
  });

  app.get('/users/@me/stickers', async (request, reply) => {
    const token = extractAuthToken(request);
    if (!token) return reply.status(401).send({ error: 'Authentication required' });
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const mine = await db.select({ beaconId: beaconMembers.beaconId }).from(beaconMembers).where(eq(beaconMembers.transmitterId, token.transmitterId));
    const ids = mine.map((m: any) => m.beaconId);
    if (!ids.length) return reply.send({ packs: [] });
    const rows = await db.select().from(beaconStickers).where(inArray(beaconStickers.beaconId, ids)).orderBy(beaconStickers.createdAt);
    const names = await db.select({ id: beacons.id, name: beacons.name, iconUrl: beacons.iconUrl }).from(beacons).where(inArray(beacons.id, ids));
    const packs = names
      .map((b: any) => ({ beacon: b, stickers: rows.filter((s: any) => s.beaconId === b.id) }))
      .filter((p: any) => p.stickers.length);
    return reply.send({ packs });
  });

  app.post('/beacons/:id/stickers', { schema: { body: { ...STICKER_BODY, required: ['name', 'emoji', 'url'] } } }, async (request, reply) => {
    const ctx = await member(request, reply, true);
    if (!ctx) return;
    const body = request.body as { name: string; description?: string | null; emoji: string; url: string };
    if (!(await validateMediaUrl(db, ctx.actorId, body.url, ['sticker']))) return reply.status(400).send({ error: 'Invalid media URL for sticker', code: 'INVALID_MEDIA_URL' });
    const count = await db.select({ id: beaconStickers.id }).from(beaconStickers).where(eq(beaconStickers.beaconId, ctx.beaconId));
    if (count.length >= MAX_STICKERS) return reply.status(400).send({ error: `A beacon can have ${MAX_STICKERS} stickers`, code: 'STICKER_LIMIT' });
    const [sticker] = await db
      .insert(beaconStickers)
      .values({ beaconId: ctx.beaconId, name: body.name.trim(), description: body.description?.trim() || null, emoji: body.emoji, url: body.url, creatorId: ctx.actorId })
      .returning();
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'sticker_create', targetType: 'sticker', targetId: sticker.id, targetName: sticker.name });
    await changed(ctx.beaconId, 'stickers');
    return reply.status(201).send({ sticker });
  });

  app.patch('/beacons/:id/stickers/:stickerId', { schema: { body: STICKER_BODY } }, async (request, reply) => {
    const ctx = await member(request, reply, true);
    if (!ctx) return;
    const { stickerId } = request.params as { stickerId: string };
    const [row] = await db.select({ creatorId: beaconStickers.creatorId }).from(beaconStickers).where(and(eq(beaconStickers.id, stickerId), eq(beaconStickers.beaconId, ctx.beaconId))).limit(1);
    if (!mayEdit(ctx, row, reply)) return;
    const { url: _url, ...body } = request.body as Record<string, any>;
    const [sticker] = await db.update(beaconStickers).set(body).where(and(eq(beaconStickers.id, stickerId), eq(beaconStickers.beaconId, ctx.beaconId))).returning();
    if (!sticker) return reply.status(404).send({ error: 'Sticker not found' });
    await changed(ctx.beaconId, 'stickers');
    return reply.send({ sticker });
  });

  app.delete('/beacons/:id/stickers/:stickerId', async (request, reply) => {
    const ctx = await member(request, reply, true);
    if (!ctx) return;
    const { stickerId } = request.params as { stickerId: string };
    const [row] = await db.select({ creatorId: beaconStickers.creatorId }).from(beaconStickers).where(and(eq(beaconStickers.id, stickerId), eq(beaconStickers.beaconId, ctx.beaconId))).limit(1);
    if (!mayEdit(ctx, row, reply)) return;
    const [sticker] = await db.delete(beaconStickers).where(and(eq(beaconStickers.id, stickerId), eq(beaconStickers.beaconId, ctx.beaconId))).returning();
    if (!sticker) return reply.status(404).send({ error: 'Sticker not found' });
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'sticker_delete', targetType: 'sticker', targetId: sticker.id, targetName: sticker.name });
    await changed(ctx.beaconId, 'stickers');
    return reply.send({ message: 'Sticker deleted' });
  });

  // ------------------------------------------------------------------ Soundboard

  app.get('/beacons/:id/sounds', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    return reply.send({ sounds: await db.select().from(soundboardSounds).where(eq(soundboardSounds.beaconId, ctx.beaconId)).orderBy(soundboardSounds.createdAt), defaults: DEFAULT_SOUNDS });
  });

  app.post('/beacons/:id/sounds', { schema: { body: { ...SOUND_BODY, required: ['name', 'url'] } } }, async (request, reply) => {
    const ctx = await member(request, reply, true);
    if (!ctx) return;
    const body = request.body as { name: string; emoji?: string | null; url: string; volume?: number };
    if (!(await validateMediaUrl(db, ctx.actorId, body.url, ['sound']))) return reply.status(400).send({ error: 'Invalid media URL for sound', code: 'INVALID_MEDIA_URL' });
    const count = await db.select({ id: soundboardSounds.id }).from(soundboardSounds).where(eq(soundboardSounds.beaconId, ctx.beaconId));
    if (count.length >= MAX_SOUNDS) return reply.status(400).send({ error: `A beacon can have ${MAX_SOUNDS} sounds`, code: 'SOUND_LIMIT' });
    const [sound] = await db
      .insert(soundboardSounds)
      .values({ beaconId: ctx.beaconId, name: body.name.trim(), emoji: body.emoji || null, url: body.url, volume: body.volume ?? 100, creatorId: ctx.actorId })
      .returning();
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'sound_create', targetType: 'sound', targetId: sound.id, targetName: sound.name });
    await changed(ctx.beaconId, 'sounds');
    return reply.status(201).send({ sound });
  });

  app.patch('/beacons/:id/sounds/:soundId', { schema: { body: SOUND_BODY } }, async (request, reply) => {
    const ctx = await member(request, reply, true);
    if (!ctx) return;
    const { soundId } = request.params as { soundId: string };
    const [row] = await db.select({ creatorId: soundboardSounds.creatorId }).from(soundboardSounds).where(and(eq(soundboardSounds.id, soundId), eq(soundboardSounds.beaconId, ctx.beaconId))).limit(1);
    if (!mayEdit(ctx, row, reply)) return;
    const { url: _url, ...body } = request.body as Record<string, any>;
    const [sound] = await db.update(soundboardSounds).set(body).where(and(eq(soundboardSounds.id, soundId), eq(soundboardSounds.beaconId, ctx.beaconId))).returning();
    if (!sound) return reply.status(404).send({ error: 'Sound not found' });
    await changed(ctx.beaconId, 'sounds');
    return reply.send({ sound });
  });

  app.delete('/beacons/:id/sounds/:soundId', async (request, reply) => {
    const ctx = await member(request, reply, true);
    if (!ctx) return;
    const { soundId } = request.params as { soundId: string };
    const [row] = await db.select({ creatorId: soundboardSounds.creatorId }).from(soundboardSounds).where(and(eq(soundboardSounds.id, soundId), eq(soundboardSounds.beaconId, ctx.beaconId))).limit(1);
    if (!mayEdit(ctx, row, reply)) return;
    const [sound] = await db.delete(soundboardSounds).where(and(eq(soundboardSounds.id, soundId), eq(soundboardSounds.beaconId, ctx.beaconId))).returning();
    if (!sound) return reply.status(404).send({ error: 'Sound not found' });
    await audit(db, { beaconId: ctx.beaconId, actorId: ctx.actorId, action: 'sound_delete', targetType: 'sound', targetId: sound.id, targetName: sound.name });
    await changed(ctx.beaconId, 'sounds');
    return reply.send({ message: 'Sound deleted' });
  });

  // ------------------------------------------------------------------ GIFs

  type Gif = { id: string; title: string; url: string; preview: string; width: number; height: number };
  /** GIPHY's shape to ours: the full GIF to send, a small one to show in the picker. */
  const toGif = (g: any): Gif => ({
    id: String(g.id),
    title: String(g.title ?? ''),
    url: g.images?.original?.url ?? g.images?.downsized?.url,
    preview: g.images?.fixed_width?.url ?? g.images?.original?.url,
    width: Number(g.images?.fixed_width?.width) || 200,
    height: Number(g.images?.fixed_width?.height) || 200,
  });
  async function giphy(path: string, params: Record<string, string>): Promise<Gif[] | null> {
    const key = process.env.GIPHY_API_KEY;
    if (!key) return null;
    const base = process.env.GIPHY_API_BASE || 'https://api.giphy.com';
    const q = new URLSearchParams({ api_key: key, rating: 'pg-13', limit: '30', ...params });
    const res = await fetch(`${base}/v1/gifs/${path}?${q}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GIPHY ${res.status}`);
    const body: any = await res.json();
    return (body.data ?? []).map(toGif).filter((g: Gif) => g.url && g.preview);
  }
  const gifRoute = (path: string) => async (request: any, reply: any) => {
    const q = String((request.query as any)?.q ?? '').trim().slice(0, 100);
    if (path === 'search' && !q) return reply.send({ gifs: [] });
    try {
      const gifs = await giphy(path, path === 'search' ? { q } : {});
      if (!gifs) return reply.status(503).send({ error: 'GIF search is not set up on this server', code: 'GIFS_NOT_CONFIGURED' });
      return reply.send({ gifs });
    } catch {
      return reply.status(502).send({ error: 'GIF search is unavailable right now', code: 'GIFS_UNAVAILABLE' });
    }
  };
  app.get('/gifs/trending', gifRoute('trending'));
  app.get('/gifs/search', gifRoute('search'));

  app.get('/users/@me/gif-favorites', async (request, reply) => {
    const token = extractAuthToken(request)!;
    const rows = await db.select().from(gifFavorites).where(eq(gifFavorites.transmitterId, token.transmitterId)).orderBy(desc(gifFavorites.createdAt)).limit(250);
    return reply.send({ favorites: rows });
  });
  app.post(
    '/users/@me/gif-favorites',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'previewUrl'],
          properties: {
            url: { type: 'string', pattern: '^https?://', maxLength: 1000 },
            previewUrl: { type: 'string', pattern: '^https?://', maxLength: 1000 },
            width: { type: 'integer', minimum: 0, maximum: 4096 },
            height: { type: 'integer', minimum: 0, maximum: 4096 },
          },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      const body = request.body as { url: string; previewUrl: string; width?: number; height?: number };
      const [existing] = await db.select().from(gifFavorites).where(and(eq(gifFavorites.transmitterId, token.transmitterId), eq(gifFavorites.url, body.url))).limit(1);
      if (existing) return reply.send({ favorite: existing });
      const [favorite] = await db.insert(gifFavorites).values({ transmitterId: token.transmitterId, ...body }).returning();
      return reply.status(201).send({ favorite });
    }
  );
  app.delete('/users/@me/gif-favorites/:id', async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { id } = request.params as { id: string };
    await db.delete(gifFavorites).where(and(eq(gifFavorites.id, id), eq(gifFavorites.transmitterId, token.transmitterId)));
    return reply.send({ message: 'Removed' });
  });

  /** Plays a sound to everyone in the comm-link; the gateway checks the sender is in it. */
  const lastPlay = new Map<string, number>();
  app.post(
    '/relays/:relayId/soundboard',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { soundId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' }, defaultSound: { type: 'string', enum: DEFAULT_SOUNDS } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request);
      if (!token) return reply.status(401).send({ error: 'Authentication required' });
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { relayId } = request.params as { relayId: string };
      const body = request.body as { soundId?: string; defaultSound?: string };
      if (!body.soundId === !body.defaultSound) return reply.status(400).send({ error: 'Send soundId or defaultSound' });
      const [relay] = await db.select().from(relays).where(eq(relays.id, relayId)).limit(1);
      if (!relay || relay.type !== 'comm_link') return reply.status(404).send({ error: 'Comm-Link not found' });
      const actor = await resolveRelayActorContext(db, token.transmitterId, relay);
      if (!actor || !hasPermission(actor.effectivePermissions, PERMISSIONS.USE_SOUNDBOARD) || !hasPermission(actor.effectivePermissions, PERMISSIONS.SPEAK_AUDIO)) {
        return reply.status(403).send({ error: 'Transmitter lacks USE_SOUNDBOARD clearance' });
      }
      // One sound a second each, so the board cannot be used to flood a room.
      const now = Date.now();
      if (now - (lastPlay.get(token.transmitterId) ?? 0) < 1000) return reply.status(429).send({ error: 'Slow down', code: 'SOUNDBOARD_COOLDOWN' });
      lastPlay.set(token.transmitterId, now);

      let sound: { id: string | null; name: string; url: string | null; volume: number; emoji: string | null; defaultSound: string | null };
      if (body.soundId) {
        const [row] = await db.select().from(soundboardSounds).where(and(eq(soundboardSounds.id, body.soundId), eq(soundboardSounds.beaconId, relay.beaconId))).limit(1);
        if (!row) return reply.status(404).send({ error: 'Sound not found' });
        sound = { id: row.id, name: row.name, url: row.url, volume: row.volume, emoji: row.emoji, defaultSound: null };
      } else {
        sound = { id: null, name: body.defaultSound!, url: null, volume: 100, emoji: null, defaultSound: body.defaultSound! };
      }
      const audience = await resolveRelayAudience(db, relayId);
      await publishGatewayEvent(app, 'SOUNDBOARD_PLAY', { relayId, senderId: token.transmitterId, sound, voice_relay_id: relayId, sender_id: token.transmitterId }, { transmitterIds: audience });
      return reply.send({ played: true });
    }
  );
};
