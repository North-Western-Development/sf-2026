import { FastifyInstance } from 'fastify';
import {
  eq,
  archivalThreads,
  pointToPointLinks,
  resolveRelayAudience,
  resolveMeshAudience,
  resolveBeaconAudience,
  resolveThreadAudience,
} from '@subspace/database';

export const GATEWAY_DISPATCH_CHANNEL = 'gateway:transmission:events';
export const GATEWAY_SESSION_CHANNEL = 'gateway:session:events';

export type Audience =
  | { relayId: string }
  | { threadId: string }
  | { meshId: string }
  | { beaconId: string; requiredPermission?: bigint }
  | { transmitterIds: string[] };

/**
 * Publish a dispatch event to the gateway. The audience is resolved here and attached
 * as `audience: string[]`; the gateway delivers only to those transmitters and drops
 * any event without one.
 */
export async function publishGatewayEvent(
  app: FastifyInstance,
  type: string,
  payload: Record<string, unknown>,
  audience: Audience
): Promise<void> {
  const redis = (app as any).redis;
  const db = (app as any).db;
  if (!redis || !(redis.status === 'ready' || redis.status === 'connect')) return;

  let ids: string[] = [];
  try {
    if ('relayId' in audience) ids = db ? await resolveRelayAudience(db, audience.relayId) : [];
    else if ('threadId' in audience) ids = db ? await resolveThreadAudience(db, audience.threadId) : [];
    else if ('meshId' in audience) ids = db ? await resolveMeshAudience(db, audience.meshId) : [];
    else if ('beaconId' in audience)
      ids = db ? await resolveBeaconAudience(db, audience.beaconId, audience.requiredPermission) : [];
    else ids = [...new Set(audience.transmitterIds.filter(Boolean))];
  } catch (err) {
    app.log.warn({ err, type }, 'Failed to resolve gateway audience; event dropped');
    return;
  }
  if (ids.length === 0) return;

  // `type` names the event; a payload's own `type` (an interaction's 2) travels as payloadType and
  // the gateway puts it back.
  const own = (payload as { type?: unknown } | null)?.type;
  await redis
    .publish(GATEWAY_DISPATCH_CHANNEL, JSON.stringify({ ...payload, type, ...(own !== undefined ? { payloadType: own } : {}), audience: ids }))
    .catch(() => {});
}

/** Audience for an existing transmission, whichever container it lives in. */
export async function audienceForTransmission(
  db: any,
  t: { relayId?: string | null; meshId?: string | null; p2pLinkId?: string | null; threadId?: string | null }
): Promise<Audience> {
  if (t.relayId) return { relayId: t.relayId };
  if (t.meshId) return { meshId: t.meshId };
  if (t.p2pLinkId && db) {
    const [link] = await db.select().from(pointToPointLinks).where(eq(pointToPointLinks.id, t.p2pLinkId)).limit(1);
    return { transmitterIds: link ? [link.transmitter1Id, link.transmitter2Id] : [] };
  }
  if (t.threadId && db) {
    const [thread] = await db.select().from(archivalThreads).where(eq(archivalThreads.id, t.threadId)).limit(1);
    // A private thread's transmissions reach only its members (and Manage Threads).
    if (thread) return thread.isPrivate ? { threadId: thread.id } : { relayId: thread.relayId };
  }
  return { transmitterIds: [] };
}

/**
 * Ask the gateway to recompute cached relationship data (presence peers, beacon ids)
 * for these transmitters, e.g. after a join, leave, affiliation accept, or mesh change.
 */
export async function publishSessionRefresh(app: FastifyInstance, transmitterIds: string[]): Promise<void> {
  const redis = (app as any).redis;
  if (!redis || !(redis.status === 'ready' || redis.status === 'connect')) return;
  await redis
    .publish(GATEWAY_SESSION_CHANNEL, JSON.stringify({ type: 'SESSION_REFRESH', transmitter_ids: transmitterIds }))
    .catch(() => {});
}
