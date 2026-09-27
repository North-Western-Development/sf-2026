#!/usr/bin/env node
// Run the root Vitest suites (unit + e2e) against the *_test database on the host.
// Usage: node scripts/native/test.mjs [vitest args...]
import { spawn } from 'node:child_process';
import { loadNativeEnv, ROOT } from './env.mjs';

const env = loadNativeEnv({ test: true });
const run = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => resolve(code ?? 1));
  });

let code = await run('pnpm', ['--filter', '@subspace/constants', '--filter', '@subspace/crypto', '--filter', '@subspace/database', 'build']);
if (code === 0) code = await run('pnpm', ['--filter', '@subspace/database', 'exec', 'drizzle-kit', 'push', '--force']);
if (code === 0) code = await run('npx', ['vitest', 'run', ...process.argv.slice(2)]);
process.exit(code);
