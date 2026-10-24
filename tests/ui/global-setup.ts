import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Redis } from 'ioredis';
import { startMockDrives } from '../support/mock-drives';

// Native ESM import of the shared .mjs env loader (Playwright compiles this file to CommonJS).
const importEsm = new Function('url', 'return import(url)') as (url: string) => Promise<any>;

export default async function globalSetup() {
  // The web server answering does not mean the API and gateway are up yet.
  const deadline = Date.now() + 120_000;
  for (const url of ['http://127.0.0.1:4001/health', 'http://localhost:4173/api/v1/auth/directives']) {
    for (;;) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`UI test stack did not come up: ${url}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Back-to-back runs come from one IP; clear the per-IP rate-limit counters (test Redis only).
  const { loadNativeEnv } = await importEsm(pathToFileURL(path.resolve(__dirname, '../../scripts/native/env.mjs')).href);
  const { REDIS_URL } = loadNativeEnv({ test: true });
  if (!/\/[1-9]\d*$/.test(REDIS_URL)) throw new Error(`Refusing to touch Redis at ${REDIS_URL}: not a test database`);
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const keys = await redis.keys('subspace-rl:*');
    if (keys.length) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }

  // Mock Google Drive / OneDrive / Dropbox for the vault drive tests (DRIVE_MOCK_ORIGIN in the test stack).
  const drives = await startMockDrives(4195).catch((err) => {
    if (err.code === 'EADDRINUSE') return null; // another run's mock is already serving
    throw err;
  });
  return async () => drives?.close();
}
