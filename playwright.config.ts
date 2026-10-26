import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV, E2E_PORT } from './tests/e2e/env';

/**
 * End-to-end tests run against a production build (`npm run build` first)
 * served on its own port with its own database, which global-setup resets.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    // Traces record request headers, including session cookies. Keep them for
    // local debugging only; CI uploads screenshots and the HTML report.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    // The standalone bundle is exactly what the Docker image runs.
    command: 'node .next/standalone/server.js',
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...E2E_ENV, PORT: String(E2E_PORT), HOSTNAME: '127.0.0.1' },
  },
});
