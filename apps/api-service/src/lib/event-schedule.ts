import type { FastifyInstance } from 'fastify';
import { and, eq, lte, inArray, beaconEvents, eventInterests } from '@subspace/database';
import { publishGatewayEvent } from './events.js';

export const RECURRENCES = ['none', 'weekly', 'biweekly', 'monthly', 'yearly', 'weekdays'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

const DAY = 86_400_000;
/** Comm-Link events have no end time; they close this long after starting. */
export const OPEN_EVENT_LIMIT_MS = 12 * 3_600_000;

/** The nth weekday of the month a date falls on (1-5), as "Monthly on the fourth Saturday" uses. */
const nthWeekday = (d: Date) => Math.ceil(d.getUTCDate() / 7);

/** The next start after `start` for a repeating event (UTC arithmetic, so the clock time is kept). */
export function nextOccurrence(start: Date, rule: Recurrence): Date | null {
  const d = new Date(start);
  switch (rule) {
    case 'weekly':
      return new Date(d.getTime() + 7 * DAY);
    case 'biweekly':
      return new Date(d.getTime() + 14 * DAY);
    case 'yearly': {
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d;
    }
    case 'weekdays': {
      let n = new Date(d.getTime() + DAY);
      while (n.getUTCDay() === 0 || n.getUTCDay() === 6) n = new Date(n.getTime() + DAY);
      return n;
    }
    case 'monthly': {
      // Same nth weekday next month; when that month has no fifth one, the last.
      const nth = nthWeekday(d);
      const weekday = d.getUTCDay();
      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes()));
      const offset = (weekday - first.getUTCDay() + 7) % 7;
      let day = 1 + offset + (nth - 1) * 7;
      const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      while (day > daysInMonth) day -= 7;
      return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day, d.getUTCHours(), d.getUTCMinutes()));
    }
    default:
      return null;
  }
}

/** When an occurrence ends, schedule the next one with the same details and interested people. */
export async function spawnNext(db: any, e: any) {
  const next = nextOccurrence(new Date(e.startAt), e.recurrence);
  if (!next) return null;
  const length = e.endAt ? new Date(e.endAt).getTime() - new Date(e.startAt).getTime() : null;
  const { id: _id, createdAt: _c, status: _s, startAt: _st, endAt: _en, ...rest } = e;
  const [row] = await db
    .insert(beaconEvents)
    .values({ ...rest, status: 'scheduled', startAt: next, endAt: length !== null ? new Date(next.getTime() + length) : null })
    .returning();
  const interested = await db.select({ transmitterId: eventInterests.transmitterId }).from(eventInterests).where(eq(eventInterests.eventId, e.id));
  if (interested.length) await db.insert(eventInterests).values(interested.map((i: any) => ({ eventId: row.id, transmitterId: i.transmitterId }))).onConflictDoNothing();
  return row;
}

/**
 * Starts events at their start time and ends them at their end time (open-ended Comm-Link
 * events after OPEN_EVENT_LIMIT_MS), spawning the next occurrence of repeating ones.
 * `serialize` turns a row into the client shape for the gateway broadcast.
 */
export async function tickEvents(app: FastifyInstance, serialize: (rows: any[]) => Promise<any[]>, now = new Date()) {
  const db = (app as any).db;
  if (!db) return { started: 0, ended: 0 };
  const broadcast = async (row: any) => {
    const [event] = await serialize([row]);
    await publishGatewayEvent(app, 'EVENT_UPSERT', { beaconId: row.beaconId, event }, { beaconId: row.beaconId });
  };

  const due = await db.select().from(beaconEvents).where(and(eq(beaconEvents.status, 'scheduled'), lte(beaconEvents.startAt, now)));
  for (const e of due) {
    const [row] = await db.update(beaconEvents).set({ status: 'active' }).where(and(eq(beaconEvents.id, e.id), eq(beaconEvents.status, 'scheduled'))).returning();
    if (row) await broadcast(row);
  }

  const live = await db.select().from(beaconEvents).where(inArray(beaconEvents.status, ['active']));
  let ended = 0;
  for (const e of live) {
    const end = e.endAt ? new Date(e.endAt).getTime() : new Date(e.startAt).getTime() + OPEN_EVENT_LIMIT_MS;
    if (end > now.getTime()) continue;
    const [row] = await db.update(beaconEvents).set({ status: 'completed', endAt: e.endAt ?? now }).where(and(eq(beaconEvents.id, e.id), eq(beaconEvents.status, 'active'))).returning();
    if (!row) continue;
    ended++;
    await broadcast(row);
    const next = await spawnNext(db, row);
    if (next) await broadcast(next);
  }
  return { started: due.length, ended };
}

/** Runs the tick every 30 s; with several API instances a Redis lock lets one do it. */
export function startEventScheduler(app: FastifyInstance, serialize: (rows: any[]) => Promise<any[]>) {
  const timer = setInterval(async () => {
    try {
      const redis = (app as any).redis;
      if (redis && !(await redis.set('lock:event-tick', '1', 'EX', 25, 'NX'))) return;
      await tickEvents(app, serialize);
    } catch (err) {
      app.log.warn({ err }, '[Events] tick failed');
    }
  }, 30_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
