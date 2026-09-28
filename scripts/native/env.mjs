// Loads the repo-root .env and derives the host-local URLs used when running
// Subspace without Docker. Values already present in process.env always win.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * @param {{ test?: boolean }} [options] test: point DATABASE_URL at the *_test database.
 */
export function loadNativeEnv({ test = false } = {}) {
  const file = parseEnvFile(path.join(ROOT, '.env'));
  const env = { ...file, ...process.env };

  const user = encodeURIComponent(env.POSTGRES_USER || 'subspace');
  const pass = encodeURIComponent(env.POSTGRES_PASSWORD || '');
  const db = env.POSTGRES_DB || 'subspace_frequency';
  const pgBase = `postgresql://${user}${pass ? `:${pass}` : ''}@127.0.0.1:5432`;

  env.DATABASE_URL ||= `${pgBase}/${db}`;
  env.TEST_DATABASE_URL ||= `${pgBase}/${db}_test`;
  env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  env.S3_ENDPOINT ||= '127.0.0.1:9000';
  env.S3_PUBLIC_ENDPOINT ||= 'http://localhost:5173';
  env.VITE_BACKEND_HOST ||= '127.0.0.1';
  // Native services are only reached through the Vite proxy; keep them off the LAN.
  env.API_HOST ||= '127.0.0.1';
  env.FILE_HOST ||= '127.0.0.1';
  env.GATEWAY_HOST ||= '127.0.0.1';

  if (test) {
    env.DATABASE_URL = env.TEST_DATABASE_URL;
    // Separate Redis logical database so rate-limit counters, refresh tokens and
    // presence from test runs never mix with development data.
    env.REDIS_URL = env.TEST_REDIS_URL || env.REDIS_URL.replace(/\/\d+$/, '') + '/1';
    env.NODE_ENV = 'test';
  }
  return env;
}
