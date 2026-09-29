import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 *  - unit:        pure, fast, no network. Runs on every commit/push and in CI.
 *  - integration: talks to the real dev stack (Postgres, Valkey, Kafka...).
 *                 Requires `pnpm dev` to be running. Files end in `.int.test.ts`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
          environment: 'node',
          setupFiles: ['packages/common/test/setup-env.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.int.test.ts', 'services/*/test/**/*.int.test.ts'],
          environment: 'node',
          globalSetup: ['packages/database/test/global-setup.int.ts'],
          setupFiles: ['packages/common/test/setup-env.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Integration tests share one real database; run files serially.
          fileParallelism: false,
        },
      },
    ],
  },
});
