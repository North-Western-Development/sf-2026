import { defineConfig, devices } from '@playwright/test';

// Smoke tests against a deployed instance (staging or production):
//   LIVE_URL=https://subspace.click pnpm test:live
// Optional: LIVE_EMAIL/LIVE_PASSWORD and LIVE_EMAIL_2/LIVE_PASSWORD_2 to use existing accounts
// instead of registering two (sign-up is rate limited per IP on a real instance).
const LIVE_URL = process.env.LIVE_URL;
if (!LIVE_URL) throw new Error('Set LIVE_URL to the instance to test, e.g. LIVE_URL=https://subspace.click');

export default defineConfig({
  testDir: 'tests/live-e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: LIVE_URL,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    permissions: ['microphone', 'camera'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
