#!/usr/bin/env node
// Run the full Subspace stack on the host (no Docker).
// Requires Postgres + Redis reachable on 127.0.0.1 (see scripts/native/README.md).
// MinIO (vault uploads) and LiveKit (voice/video) are optional.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { loadNativeEnv, ROOT } from './env.mjs';
import { ensureInfra } from './infra.mjs';


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

const env = loadNativeEnv();

const probe = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.setTimeout(1500);
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.once('timeout', () => (s.destroy(), resolve(false)));
  });

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });

const required = { Postgres: 5432, Redis: 6379 };
for (const [name, port] of Object.entries(required)) {
  if (!(await probe(port))) {
    console.error(`
[native] ${name} is not reachable on 127.0.0.1:${port}. See scripts/native/README.md.
`);
    process.exit(1);
  }
}
const infra = await ensureInfra(env);
if (!infra.minio) console.warn('[native] MinIO unavailable: Subspace Vault uploads will fail.');
if (!infra.livekit) console.warn('[native] LiveKit unavailable: Comm-Link voice/video will fail.');

console.log('[native] Building shared packages...');
await run('pnpm', ['--filter', '@subspace/constants', '--filter', '@subspace/crypto', '--filter', '@subspace/database', 'build']);

console.log('[native] Syncing database schema...');
if ((await pushSchema(env, ROOT)) !== 0) {
  console.error('[native] Schema push failed.');
  process.exit(1);
}

console.log('[native] Starting services (web on http://localhost:5173)...');
const services = ['@subspace/api-service', '@subspace/gateway-service', '@subspace/file-service', '@subspace/badge-worker', '@subspace/web'];
const child = spawn('pnpm', ['--parallel', ...services.flatMap((s) => ['--filter', s]), 'dev'], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
