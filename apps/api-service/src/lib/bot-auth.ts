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

const FORGET_CHANNEL = 'bot-tokens:forget';

/**
 * A reset or deleted bot token stops working at once: here, and (through Redis) on every other
 * API instance, whose caches would otherwise still accept it for up to a minute.
 */
export async function forgetBotTokens(redis?: { publish(channel: string, message: string): Promise<unknown> } | null) {
  cache.clear();
  await redis?.publish(FORGET_CHANNEL, '1').catch(() => {});
}

/** Clear this instance's cache whenever another one forgets tokens. Returns a stop function. */
export async function listenForForgottenTokens(redis: { duplicate(options?: object): any } | null): Promise<() => Promise<void>> {
  if (!redis) return async () => {};
  // Its own connection, which (unlike the shared client) keeps reconnecting and resubscribes.
  const sub = redis.duplicate({ lazyConnect: false, enableOfflineQueue: true, maxRetriesPerRequest: null, retryStrategy: (n: number) => Math.min(n * 500, 10_000) });
  sub.on?.('error', () => {});
  sub.on('message', (channel: string) => {
    if (channel === FORGET_CHANNEL) cache.clear();
  });
  await sub.subscribe(FORGET_CHANNEL);
  return async () => {
    await sub.quit().catch(() => sub.disconnect());
  };
}

/** For tests: how many tokens this instance remembers. */
export const cachedBotTokens = () => cache.size;

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
