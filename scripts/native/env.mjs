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
    // Phone verification without Twilio: texts land in the dev:sms outbox, limits are loose
    // (every test signs up from 127.0.0.1), and there is no VPN lookup.
    env.SMS_DEV_OUTBOX = 'true';
    env.PHONE_VPN_CHECK = 'off';
    for (const k of ['PHONE_VERIFY_PER_USER', 'PHONE_VERIFY_PER_IP', 'PHONE_CODES_PER_USER', 'PHONE_CODES_PER_NUMBER', 'PHONE_CODES_PER_IP', 'EMAIL_VERIFY_PER_USER', 'EMAIL_VERIFY_PER_IP', 'EMAIL_CODES_PER_USER', 'EMAIL_CODES_PER_ADDRESS', 'EMAIL_CODES_PER_IP']) env[k] = '1000/1m';
  }
  return env;
}

/** Start every run from an empty test Redis database (never the dev one). */
export async function flushTestRedis(url) {
  if (!/\/[1-9]\d*$/.test(url)) {
    console.error(`[native] Refusing to flush Redis at ${url}: tests must use a non-zero database index.`);
    return 1;
  }
  const { createRequire } = await import('node:module');
  const { Redis } = createRequire(path.join(ROOT, 'apps/api-service/package.json'))('ioredis');
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await client.connect();
    await client.flushdb();
    return 0;
  } catch (err) {
    console.error('[native] Could not reset the test Redis database:', err.message);
    return 1;
  } finally {
    client.disconnect();
  }
}
