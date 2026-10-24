import { defineConfig, devices } from '@playwright/test';

// Captures a picture of every screen into screenshots/ (not a test suite):
//   npx playwright test --config playwright.screens.config.ts
// Uses the browser-test stack (port 4173) and its fixtures.
export default defineConfig({
  testDir: 'tests/screens',
  testMatch: '**/*.screens.ts',
  globalSetup: './tests/ui/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    actionTimeout: 10_000,
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    permissions: ['microphone', 'camera'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
