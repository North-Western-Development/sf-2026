#!/usr/bin/env node
// Apply the generated SQL migrations in ../drizzle to DATABASE_URL.
//
//   node scripts/migrate.mjs            apply what is pending
//   node scripts/migrate.mjs --status   print empty | unadopted | adopted, then exit
//   node scripts/migrate.mjs --adopt    a database built by `drizzle-kit push` before migrations
//                                       existed: record every migration as applied, run none
//
// Adopt only a database whose schema already matches the migrations (push it first). After
// that, schema changes ship as migrations: edit src/schema*.ts, run `pnpm db:generate`, review
// the SQL, commit it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';

const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
const TABLE = '__drizzle_migrations';
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const exists = async (table) => (await client.query('SELECT to_regclass($1) AS t', [`public.${table}`])).rows[0].t !== null;

async function status() {
  if (await exists(TABLE)) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM public."${TABLE}"`);
    if (rows[0].n > 0) return 'adopted';
  }
  return (await exists('transmitters')) ? 'unadopted' : 'empty';
}

try {
  const mode = process.argv[2];
  const now = await status();
  if (mode === '--status') {
    console.log(now);
  } else if (mode === '--adopt') {
    if (now !== 'unadopted') {
      console.log(`nothing to adopt (${now})`);
    } else {
      await client.query(`CREATE TABLE IF NOT EXISTS public."${TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
      for (const m of readMigrationFiles({ migrationsFolder: folder })) {
        await client.query(`INSERT INTO public."${TABLE}" (hash, created_at) VALUES ($1, $2)`, [m.hash, m.folderMillis]);
      }
      console.log('adopted: existing schema recorded as migrated');
    }
  } else {
    if (now === 'unadopted') {
      console.error('This database was built by schema push and has not been adopted: push it, then run with --adopt');
      process.exit(2);
    }
    await migrate(drizzle(client), { migrationsFolder: folder, migrationsSchema: 'public', migrationsTable: TABLE });
    console.log('migrations applied');
  }
} catch (err) {
  console.error(`migration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
