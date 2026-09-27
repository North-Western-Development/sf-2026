import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { TERMINOLOGY, STAFF_RANKS } from '@subspace/constants';
import {
  createDatabaseClient,
  eq,
  and,
  commendations,
  transmitterCommendations,
  transmitters,
} from '@subspace/database';

// Package-local .env first, then the repo-root .env (native runs); existing env always wins.
dotenv.config({ path: ['.env', '../../.env'] });

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const databaseUrl =
  process.env.DATABASE_URL ||
  'postgresql://subspace:subspace_secret@postgres:5432/subspace_frequency';

export const TELEMETRY_STREAM = 'subspace:telemetry:events';
export const CONSUMER_GROUP = 'badge-workers';

export interface TelemetryPayload {
  transmitterId: string;
  eventType: 'account_age' | 'voice_minutes' | 'screenshare_minutes' | 'transmissions_sent' | 'staff_promoted';
  amount?: number;
  currentStaffRank?: number;
}

/**
 * Evaluates telemetry against commendation thresholds and awards eligible badges
 */
export async function evaluateAndAwardCommendations(
  db: any,
  redis: Redis | null,
  payload: TelemetryPayload
): Promise<Array<typeof commendations.$inferSelect>> {
  const { transmitterId, eventType, amount, currentStaffRank } = payload;
  const awardedList: Array<typeof commendations.$inferSelect> = [];

  // 1. Fetch potential commendations for this criteria type
  const targetCriteria = eventType === 'staff_promoted' ? 'staff' : eventType;
  const candidates = await db
    .select()
    .from(commendations)
    .where(eq(commendations.criteriaType, targetCriteria));

  for (const candidate of candidates) {
    let qualifies = false;

    if (candidate.criteriaType === 'staff') {
      const rank = currentStaffRank ?? 0;
      qualifies = rank >= candidate.threshold && candidate.threshold > 0;
    } else if (amount !== undefined) {
      qualifies = amount >= candidate.threshold;
    }

    if (!qualifies) continue;

    // Check if already awarded
    const [existing] = await db
      .select()
      .from(transmitterCommendations)
      .where(
        and(
          eq(transmitterCommendations.transmitterId, transmitterId),
          eq(transmitterCommendations.commendationId, candidate.id)
        )
      )
      .limit(1);

    if (!existing) {
      await db.insert(transmitterCommendations).values({
        transmitterId,
        commendationId: candidate.id,
        displayOrder: 0,
        isVisible: true,
      });

      awardedList.push(candidate);

      // Publish real-time notification to Redis Pub/Sub for live clients
      if (redis) {
        await redis.publish(
          `transmitter:${transmitterId}:notifications`,
          JSON.stringify({
            type: 'COMMENDATION_AWARDED',
            commendation: candidate,
            awardedAt: new Date().toISOString(),
          })
        );
      }
    }
  }

  return awardedList;
}

export async function startBadgeWorker() {
  console.log(`[Badge Worker] Initializing Commendations engine for ${TERMINOLOGY.BADGES}...`);

  let db: any = null;
  let redis: Redis | null = null;

  try {
    const dbClient = createDatabaseClient(databaseUrl);
    db = dbClient.db;
    await dbClient.pool.query('SELECT 1');
  } catch (err: any) {
    console.warn('[Badge Worker] Database connection delayed:', err.message);
  }

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await redis.connect();
    console.log('[Badge Worker] Connected to Redis Streams telemetry bus.');

    // Ensure consumer group exists
    try {
      await redis.xgroup('CREATE', TELEMETRY_STREAM, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (e: any) {
      // Group already exists
    }
  } catch (err: any) {
    console.warn('[Badge Worker] Redis stream connection delayed:', err.message);
  }

  // Background stream processor
  let isRunning = true;
  const poll = async () => {
    while (isRunning && redis && db) {
      try {
        const response: any = await redis.xreadgroup(
          'GROUP',
          CONSUMER_GROUP,
          'worker-1',
          'COUNT',
          10,
          'BLOCK',
          2000,
          'STREAMS',
          TELEMETRY_STREAM,
          '>'
        );

        if (response && response.length > 0) {
          const streamData = response[0][1];
          for (const [id, fields] of streamData) {
            const data: Record<string, any> = {};
            for (let i = 0; i < fields.length; i += 2) {
              data[fields[i]] = fields[i + 1];
            }

            if (data.payload) {
              const parsed: TelemetryPayload = JSON.parse(data.payload);
              await evaluateAndAwardCommendations(db, redis, parsed);
            }

            await redis.xack(TELEMETRY_STREAM, CONSUMER_GROUP, id);
          }
        }
      } catch (err: any) {
        if (!isRunning) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };

  if (process.env.NODE_ENV !== 'test') {
    poll();
  }

  return {
    redis,
    db,
    stop: () => {
      isRunning = false;
    },
  };
}

if (process.env.NODE_ENV !== 'test') {
  startBadgeWorker();
}

