import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // Applied migrations are recorded in public.__drizzle_migrations (see scripts/migrate.mjs).
  migrations: { schema: 'public', table: '__drizzle_migrations' },
  // `drizzle-kit push` (adopting an old database, local experiments) must never drop that record.
  tablesFilter: ['!__drizzle_migrations'],
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://subspace:subspace_secret@localhost:5432/subspace_frequency',
  },
});
