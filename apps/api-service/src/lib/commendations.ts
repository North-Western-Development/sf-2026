import type { FastifyInstance } from 'fastify';
import { awardEligibleCommendations, countTransmissionsSent, statsKey } from '@subspace/database';

/** Voice minutes come from the gateway's Redis totals; 0 when Redis is down. */
async function voiceMinutes(app: FastifyInstance, transmitterId: string) {
  const redis = (app as any).redis;
  return redis ? Number(await redis.hget(statsKey(transmitterId), 'voiceMinutes')) || 0 : 0;
}

/** The activity totals badges are measured against. */
export async function commendationStats(app: FastifyInstance, db: any, target: { id: string }) {
  const [voice, sent] = await Promise.all([voiceMinutes(app, target.id).catch(() => 0), countTransmissionsSent(db, target.id)]);
  return { voiceMinutes: voice, transmissionsSent: sent };
}

/**
 * Awards any badges the transmitter has earned since they were last checked. Runs when a
 * profile is viewed; a failure here never blocks the profile itself.
 */
export async function refreshCommendations(app: FastifyInstance, db: any, target: { id: string; staffRank: number; createdAt: Date | string }) {
  try {
    return await awardEligibleCommendations(db, target.id, {
      staffRank: target.staffRank ?? 0,
      createdAt: new Date(target.createdAt),
      voiceMinutes: await voiceMinutes(app, target.id),
      transmissionsSent: () => countTransmissionsSent(db, target.id),
    });
  } catch (err) {
    app.log.warn({ err }, '[Commendations] could not refresh badges');
    return [];
  }
}
