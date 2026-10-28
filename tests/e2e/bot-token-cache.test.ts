import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { cachedBotTokens, resolveBotToken } from '../../apps/api-service/src/lib/bot-auth.js';

/**
 * Fixed (was a security bug): each API instance keeps bot tokens it has seen for a minute, and a
 * token reset only cleared the instance that handled it. Now the reset is broadcast over Redis.
 * Two apps in one test process would share this module's cache, so "another instance" is a
 * separate Redis client publishing, as the other instance's forgetBotTokens() does.
 */
describe('Bot token cache across instances', () => {
  let app: FastifyInstance;
  let other: any;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    const redis = (app as any).redis;
    if (redis) other = redis.duplicate({ lazyConnect: false, enableOfflineQueue: true });
  });

  afterAll(async () => {
    await other?.quit().catch(() => {});
    await app?.close();
  });

  const until = async (check: () => boolean) => {
    for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    return check();
  };

  it('a reset on another instance empties this one at once', async () => {
    const db = (app as any).db;
    if (!db) return;
    expect(other, 'Redis is needed for this test').toBeTruthy();
    await resolveBotToken(db, 'not-a-real-token-1');
    expect(cachedBotTokens()).toBeGreaterThan(0);
    // Only the message: this module's own cache.clear() must not be what empties it.
    await other.publish('bot-tokens:forget', '1');
    expect(await until(() => cachedBotTokens() === 0)).toBe(true);
  });

  it('a stray message on another channel does not clear it', async () => {
    const db = (app as any).db;
    if (!db) return;
    expect(other, 'Redis is needed for this test').toBeTruthy();
    await resolveBotToken(db, 'not-a-real-token-2');
    await other.publish('bot-tokens:other', '1');
    await new Promise((r) => setTimeout(r, 150));
    expect(cachedBotTokens()).toBeGreaterThan(0);
  });
});
