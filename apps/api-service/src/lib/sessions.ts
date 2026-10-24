import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { GATEWAY_SESSION_CHANNEL } from './events.js';

/**
 * Device sessions ("Logged-in Devices"). Each sign-in creates one, stored in the Redis hash
 * `sessions:<transmitterId>`; refresh tokens and access tokens carry its id, and a session
 * removed from the hash stops working on the next request.
 */
export interface DeviceSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  userAgent: string;
  ip: string;
}

const key = (transmitterId: string) => `sessions:${transmitterId}`;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function describe(request?: FastifyRequest) {
  return {
    userAgent: String(request?.headers['user-agent'] ?? '').slice(0, 300),
    ip: request?.ip ?? '',
  };
}

export async function createSession(redis: any, transmitterId: string, request?: FastifyRequest): Promise<string> {
  const id = randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  const session: DeviceSession = { id, createdAt: now, lastActiveAt: now, ...describe(request) };
  if (redis) {
    await redis.hset(key(transmitterId), id, JSON.stringify(session)).catch(() => {});
    await redis.expire(key(transmitterId), SESSION_TTL_SECONDS).catch(() => {});
  }
  return id;
}

/** Marks a session used (on token refresh). Returns false when it was revoked. */
export async function touchSession(redis: any, transmitterId: string, id: string, request?: FastifyRequest): Promise<boolean> {
  if (!redis) return true;
  const raw = await redis.hget(key(transmitterId), id);
  if (!raw) return false;
  const session: DeviceSession = { ...JSON.parse(raw), lastActiveAt: new Date().toISOString(), ...describe(request) };
  await redis.hset(key(transmitterId), id, JSON.stringify(session));
  await redis.expire(key(transmitterId), SESSION_TTL_SECONDS).catch(() => {});
  return true;
}

export async function sessionExists(redis: any, transmitterId: string, id: string): Promise<boolean> {
  if (!redis) return true;
  return (await redis.hexists(key(transmitterId), id)) === 1;
}

export async function listSessions(redis: any, transmitterId: string): Promise<DeviceSession[]> {
  if (!redis) return [];
  const all: Record<string, string> = await redis.hgetall(key(transmitterId));
  return Object.values(all)
    .map((raw) => JSON.parse(raw) as DeviceSession)
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

/**
 * Revoke sessions (all of them when `ids` is omitted, optionally sparing `keep`) and ask the
 * gateway to drop their sockets. Returns the revoked ids.
 */
export async function revokeSessions(
  app: FastifyInstance,
  transmitterId: string,
  opts: { ids?: string[]; keep?: string } = {}
): Promise<string[]> {
  const redis = (app as any).redis;
  if (!redis) return [];
  const existing: string[] = await redis.hkeys(key(transmitterId));
  const ids = (opts.ids ?? existing).filter((id) => id !== opts.keep && existing.includes(id));
  if (ids.length) await redis.hdel(key(transmitterId), ...ids);
  // Sockets opened with tokens that predate session ids are closed too when revoking everything.
  await redis
    .publish(
      GATEWAY_SESSION_CHANNEL,
      JSON.stringify({ type: 'SESSION_REVOKE', transmitter_id: transmitterId, session_ids: ids, all: !opts.ids, keep: opts.keep ?? null })
    )
    .catch(() => {});
  return ids;
}
