#!/usr/bin/env node
// Run the root Vitest suites (unit + e2e) against the *_test database on the host.
// Usage: node scripts/native/test.mjs [vitest args...]
import { spawn } from 'node:child_process';
import { loadNativeEnv, ROOT } from './env.mjs';


// drizzle-kit exits 0 even when a statement fails, so inspect its output.
const pushSchema = (env, cwd) =>
  new Promise((resolve) => {
    const child = spawn('pnpm', ['--filter', '@subspace/database', 'exec', 'drizzle-kit', 'push', '--force'], {
      cwd,
      env,
      shell: process.platform === 'win32',
    });
    let out = '';
    child.stdout.on('data', (d) => ((out += d), process.stdout.write(d)));
    child.stderr.on('data', (d) => ((out += d), process.stderr.write(d)));
    child.on('exit', (code) => resolve(code === 0 && !/^error:/m.test(out) ? 0 : 1));
  });

const env = loadNativeEnv({ test: true });
const run = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => resolve(code ?? 1));
  });

let code = await run('pnpm', ['--filter', '@subspace/constants', '--filter', '@subspace/crypto', '--filter', '@subspace/database', 'build']);
if (code === 0) code = await pushSchema(env, ROOT);
if (code !== 0) console.error('[native] Schema push failed.');
if (code === 0) code = await run('npx', ['vitest', 'run', ...process.argv.slice(2)]);
process.exit(code);
