import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export * from './schema.js';

export function createDatabaseClient(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}
