import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the website, on a desktop and a phone. Locally they reuse
 * `pnpm dev` if it's running; in CI they run against the production build.
 * Tests that need the API stack skip themselves when it isn't reachable.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Session tests talk to the API, not the layout: once (on desktop) is enough, and keeps
    // the test sign-ins under the API's per-address sign-in limit.
    { name: 'phone', use: { ...devices['Pixel 7'] }, testIgnore: /session\.spec\.ts/ },
  ],
  webServer: {
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
