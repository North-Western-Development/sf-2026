// Database schema for the native runners: generated SQL migrations (packages/database/drizzle).
// A database first built by `drizzle-kit push` is pushed one last time and adopted, then only
// ever migrated.
import { spawn } from 'node:child_process';
import { ROOT } from './env.mjs';

const exec = (args, env, { quiet = false } = {}) =>
  new Promise((resolve) => {
    const child = spawn('pnpm', ['--filter', '@subspace/database', 'exec', ...args], { cwd: ROOT, env, shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (d) => ((out += d), quiet || process.stdout.write(d)));
    child.stderr.on('data', (d) => ((out += d), process.stderr.write(d)));
    // drizzle-kit exits 0 even when a statement fails, so inspect its output too.
    child.on('exit', (code) => resolve({ code: code === 0 && !/^error:/m.test(out) ? 0 : 1, out }));
  });

/** Bring the database up to date. Returns 0 on success. */
export async function syncSchema(env) {
  const status = await exec(['node', 'scripts/migrate.mjs', '--status'], env, { quiet: true });
  if (status.code !== 0) return 1;
  if (status.out.includes('unadopted')) {
    console.log('[native] Adopting a pushed database into migrations...');
    if ((await exec(['drizzle-kit', 'push', '--force'], env)).code !== 0) return 1;
    if ((await exec(['node', 'scripts/migrate.mjs', '--adopt'], env)).code !== 0) return 1;
  }
  return (await exec(['node', 'scripts/migrate.mjs'], env)).code;
}

/**
 * Fail when src/schema*.ts changed without a migration. drizzle-kit generate writes the missing
 * migration as it reports it, so the fix is to review and commit that file.
 */
export async function checkMigrationsCurrent(env) {
  const { code, out } = await exec(['drizzle-kit', 'generate', '--name', 'pending'], env, { quiet: true });
  if (code !== 0) return 1;
  if (/No schema changes/i.test(out)) return 0;
  console.error('[native] The schema changed without a migration. One was generated in packages/database/drizzle: review it, commit it, and rerun.');
  return 1;
}
