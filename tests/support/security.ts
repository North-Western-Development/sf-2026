import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, beacons, oauthApps, appBots, webhooks, devTeams, staffAuditLog, eq, inArray, or } from '@subspace/database';

/**
 * Shared bits for the security-*.test.ts suites: people seeded straight into the database, an
 * authenticated caller, the gateway bus, and a cleanup that also removes the accounts apps make
 * for themselves (bot users and webhook authors), which do not cascade from their owners.
 */

export type Person = { id: string; username: string; staffRank?: number };

export const person = (id: string, username: string, staffRank = 0): Person => ({ id, username, staffRank });

export function caller(app: () => FastifyInstance) {
  const SECRET = getJwtSecret();
  const auth = (u: Person) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: u.staffRank ?? 0 }, SECRET)}` });
  const call = (u: Person | null, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app().inject({ method: method as any, url: `/api/v1${url}`, headers: { ...(u ? auth(u) : {}), ...headers }, payload: payload as any });
  const asBot = (token: string, method: string, url: string, payload?: unknown) =>
    app().inject({ method: method as any, url: `/api/v1${url}`, headers: { authorization: `Bot ${token}` }, payload: payload as any });
  return { call, auth, asBot };
}

/** Insert people (removing leftovers of an earlier, interrupted run first). */
export async function seedPeople(db: any, people: Person[], extra: (p: Person) => Record<string, unknown> = () => ({})) {
  await cleanupPeople(db, people);
  await db.insert(transmitters).values(
    people.map((p) => ({
      id: p.id,
      username: p.username,
      discriminator: '0420',
      email: `${p.username}@subspace.test`,
      passwordHash: 'x',
      displayName: p.username,
      isEmailVerified: true,
      staffRank: p.staffRank ?? 0,
      ...extra(p),
    }))
  );
}

/** Everything these people own: beacons (and the webhook authors in them), apps (and their bot users), teams, audit rows. */
export async function cleanupPeople(db: any, people: Person[]) {
  if (!db) return;
  const ids = people.map((p) => p.id);
  const ownedBeacons = (await db.select({ id: beacons.id }).from(beacons).where(inArray(beacons.ownerId, ids))).map((b: any) => b.id);
  const ownedApps = (await db.select({ id: oauthApps.id }).from(oauthApps).where(inArray(oauthApps.ownerId, ids))).map((a: any) => a.id);
  const botUsers = ownedApps.length ? (await db.select({ id: appBots.userId }).from(appBots).where(inArray(appBots.appId, ownedApps))).map((b: any) => b.id) : [];
  const hookAuthors = ownedBeacons.length
    ? (await db.select({ id: webhooks.authorId }).from(webhooks).where(or(inArray(webhooks.beaconId, ownedBeacons), inArray(webhooks.creatorId, ids)))).map((w: any) => w.id)
    : (await db.select({ id: webhooks.authorId }).from(webhooks).where(inArray(webhooks.creatorId, ids))).map((w: any) => w.id);
  await db.delete(staffAuditLog).where(inArray(staffAuditLog.actorId, ids));
  if (ownedBeacons.length) await db.delete(beacons).where(inArray(beacons.id, ownedBeacons));
  await db.delete(devTeams).where(inArray(devTeams.ownerId, ids));
  if (ownedApps.length) await db.delete(oauthApps).where(inArray(oauthApps.id, ownedApps));
  const extra = [...botUsers, ...hookAuthors];
  if (extra.length) await db.delete(transmitters).where(inArray(transmitters.id, extra));
  await db.delete(transmitters).where(inArray(transmitters.id, ids));
}

/** Gateway dispatch events the API publishes while `action` runs. */
export async function captureBus(action: () => Promise<unknown>, settleMs = 200): Promise<any[]> {
  const sub = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
  const events: any[] = [];
  try {
    await sub.connect();
  } catch {
    await action();
    return events;
  }
  await sub.psubscribe('gateway:*');
  sub.on('pmessage', (_p, _c, m) => {
    try {
      events.push(JSON.parse(m));
    } catch {
      /* not JSON */
    }
  });
  try {
    await action();
    await new Promise((r) => setTimeout(r, settleMs));
  } finally {
    await sub.quit().catch(() => {});
  }
  return events;
}

/** Whether any of these secrets (or obviously secret field names) appear anywhere in a response body. */
export function leaks(body: string, secrets: string[]): string[] {
  const found = secrets.filter((s) => s && body.includes(s));
  for (const k of ['tokenHash', 'token_hash', 'privateKeyEnc', 'private_key_enc', 'clientSecretHash', 'client_secret_hash', 'passwordHash', 'password_hash']) if (body.includes(`"${k}"`)) found.push(k);
  return found;
}
