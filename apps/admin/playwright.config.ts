import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the admin app. Locally they reuse `pnpm dev` (port 3200) if
 * it's running; tests that need the API stack skip themselves without it.
 */
const baseURL = process.env.E2E_ADMIN_URL ?? 'http://localhost:3200';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? undefined : 2,
  expect: { timeout: process.env.CI ? 5_000 : 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: `${baseURL}/signin`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
