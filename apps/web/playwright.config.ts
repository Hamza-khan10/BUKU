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
    // Sign-in and session tests (session, signin, team-signin) are about the API round trip,
    // not the layout: once, on desktop, is enough.
    { name: 'phone', use: { ...devices['Pixel 7'] }, testIgnore: /(session|signin)\.spec\.ts/ },
  ],
  webServer: {
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
