import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export * from './schema.js';
export * from './snowflake.js';
export * from './access.js';
export * from './commendations.js';
export * from './storage-limits.js';
export * from './region.js';
export * from './staff.js';
export * from './developers.js';
export * from 'drizzle-orm';

export function createDatabaseClient(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}
