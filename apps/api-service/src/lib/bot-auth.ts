import { eq, appBots, transmitters } from '@subspace/database';
import { hashSecret } from './app-users.js';

export interface BotIdentity {
  transmitterId: string;
  username: string;
  staffRank: 0;
  appId: string;
  bot: true;
}

/** Bot tokens seen recently (a minute), so every request does not hit the database. */
const cache = new Map<string, { at: number; who: BotIdentity | null }>();

/** The bot behind an `Authorization: Bot <token>` header, or null. */
export async function resolveBotToken(db: any, token: string): Promise<BotIdentity | null> {
  const key = hashSecret(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.who;
  const [row] = await db
    .select({ appId: appBots.appId, userId: appBots.userId, username: transmitters.username })
    .from(appBots)
    .innerJoin(transmitters, eq(transmitters.id, appBots.userId))
    .where(eq(appBots.tokenHash, key))
    .limit(1);
  const who: BotIdentity | null = row ? { transmitterId: row.userId, username: row.username, staffRank: 0, appId: row.appId, bot: true } : null;
  if (cache.size > 5000) cache.clear();
  cache.set(key, { at: Date.now(), who });
  return who;
}

/** A reset or deleted bot token stops working at once. */
export const forgetBotTokens = () => cache.clear();

/**
 * What a bot may call: reading beacons it is in, messages, reactions, pins, threads, polls,
 * moderation its permissions allow, its own app's commands and interaction replies. Not
 * account, settings, DM or anything person-only.
 */
const BOT_ROUTES: RegExp[] = [
  /^GET \/api\/v1\/bots\/@me$/,
  // A beacon by its route parameter only: not /beacons/discovery, /beacons/me and the like.
  /^GET \/api\/v1\/beacons\/:[A-Za-z]+(\/(relays|members|clearances|bans))?$/,
  /^(GET|POST) \/api\/v1\/channels\/:channelType\/:channelId\/(transmissions|typing|pins)$/,
  /^(PUT|POST) \/api\/v1\/channels\/:channelType\/:channelId\/transmissions\/:transmissionId\/poll\/(votes|end)$/,
  /^(PATCH|DELETE) \/api\/v1\/transmissions\/:id$/,
  /^(GET|PUT|DELETE) \/api\/v1\/transmissions\/:id\/reactions\//,
  /^(PUT|DELETE) \/api\/v1\/transmissions\/:id\/pin$/,
  /^(GET|POST) \/api\/v1\/relays\/:relayId\/threads$/,
  /^(PATCH) \/api\/v1\/relays\/:relayId\/threads\/:threadId$/,
  /^(PUT|DELETE) \/api\/v1\/relays\/:relayId\/threads\/:threadId\/members\/:userId$/,
  /^GET \/api\/v1\/users\/:id\/profile$/,
  /^PATCH \/api\/v1\/beacons\/:beaconId\/voice-states\/:userId$/,
  /^POST \/api\/v1\/beacons\/:id\/members\/:targetId\/kick$/,
  /^PUT \/api\/v1\/beacons\/:id\/members\/:targetId\/timeout$/,
  /^(PUT|DELETE) \/api\/v1\/beacons\/:id\/bans\/:userId$/,
  /^POST \/api\/v1\/beacons\/:id\/clearances\/members\/:targetId\/assign$/,
  /^(GET|PUT) \/api\/v1\/applications\/:appId\/commands$/,
  /^(GET|PUT) \/api\/v1\/applications\/:appId\/beacons\/:beaconId\/commands$/,
  /^(POST|PATCH|DELETE) \/api\/v1\/interactions\/:id\/:token(\/[a-z-]+)?$/,
  // Leaving a beacon (or, with Kick Members, removing another bot).
  /^DELETE \/api\/v1\/beacons\/:id\/bots\/:appId$/,
];

export const botMayUse = (method: string, url: string) => BOT_ROUTES.some((r) => r.test(`${method} ${url}`));
