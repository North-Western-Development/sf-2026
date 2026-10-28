import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

/**
 * Snowflake IDs, as Discord uses: 64 bits, stored as bigint and sent as decimal strings
 * (JavaScript numbers cannot hold 64 bits exactly).
 *
 *   42 bits  milliseconds since SNOWFLAKE_EPOCH
 *   10 bits  worker (SNOWFLAKE_WORKER_ID, one per process)
 *   12 bits  sequence within the millisecond
 *
 * IDs sort by creation time, and the time can be read back with snowflakeTime().
 */

/** 2026-01-01T00:00:00Z. */
export const SNOWFLAKE_EPOCH = 1767225600000n;

/** For JSON Schema `pattern`: a snowflake in decimal. */
export const SNOWFLAKE_PATTERN = '^[1-9][0-9]{0,18}$';
/** For building regular expressions that find snowflakes inside text (mentions, glyphs). */
export const SNOWFLAKE_SOURCE = '[1-9][0-9]{0,18}';

const SNOWFLAKE_RE = new RegExp(SNOWFLAKE_PATTERN);
export const isSnowflake = (value: unknown): value is string => typeof value === 'string' && SNOWFLAKE_RE.test(value) && BigInt(value) < 1n << 63n;

function workerId(): bigint {
  const fromEnv = Number(process.env.SNOWFLAKE_WORKER_ID);
  // 1023 is the database's own (subspace_snowflake(), for rows inserted by SQL).
  if (Number.isInteger(fromEnv) && fromEnv >= 0 && fromEnv < 1023) return BigInt(fromEnv);
  // Without one: the process id, which differs between processes running at the same time on
  // a host. Set SNOWFLAKE_WORKER_ID for each service so two can never share a worker.
  return BigInt(process.pid % 1023);
}

const WORKER = workerId();
let lastMs = -1n;
let sequence = 0n;

export function newSnowflake(): string {
  let now = BigInt(Date.now()) - SNOWFLAKE_EPOCH;
  if (now < lastMs) now = lastMs; // the clock stepped back: keep counting from where we were
  if (now === lastMs) {
    sequence = (sequence + 1n) & 4095n;
    if (sequence === 0n) {
      // 4096 IDs this millisecond: wait for the next one.
      while (BigInt(Date.now()) - SNOWFLAKE_EPOCH <= lastMs) {
        /* spin, under a millisecond */
      }
      now = BigInt(Date.now()) - SNOWFLAKE_EPOCH;
    }
  } else {
    sequence = 0n;
  }
  lastMs = now;
  return ((now << 22n) | (WORKER << 12n) | sequence).toString();
}

/** When a snowflake was made. */
export const snowflakeTime = (id: string): Date => new Date(Number((BigInt(id) >> 22n) + SNOWFLAKE_EPOCH));

/** A snowflake column: bigint in Postgres, a decimal string in JavaScript. */
export const snowflake = customType<{ data: string; driverData: string }>({
  dataType: () => 'bigint',
  fromDriver: (value) => String(value),
  toDriver: (value) => value,
});

/**
 * A primary key: made here when the app inserts, and by Postgres's subspace_snowflake()
 * (created in the baseline migration) for rows inserted with plain SQL.
 */
export const snowflakeId = (name: string) => snowflake(name).primaryKey().default(sql`subspace_snowflake()`).$defaultFn(newSnowflake);
