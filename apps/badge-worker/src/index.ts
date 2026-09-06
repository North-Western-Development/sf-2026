import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { TERMINOLOGY } from '@subspace/constants';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

export async function startBadgeWorker() {
  console.log(`[Badge Worker] Initializing Commendations engine for ${TERMINOLOGY.BADGES}...`);

  let redis: Redis | null = null;
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await redis.connect();
    console.log('[Badge Worker] Connected to Redis Streams telemetry bus.');
  } catch (err: any) {
    console.warn('[Badge Worker] Redis stream connection delayed:', err.message);
  }

  return { redis };
}

if (process.env.NODE_ENV !== 'test') {
  startBadgeWorker();
}
