import { defineConfig } from 'tsup';

/**
 * Production build shared by every service (`pnpm --filter @buku/<svc> build`).
 *
 * Workspace packages (@buku/*) are TypeScript source, so they are BUNDLED into
 * the service's single dist/index.js. Third-party packages stay EXTERNAL and
 * are installed into the image's node_modules — native modules (Kafka's
 * librdkafka binding) and Prisma's runtime cannot be bundled safely.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  splitting: false,
  minify: false,
  noExternal: [/^@buku\//],
  // Everything else that is a bare package import stays external — including
  // dependencies of @buku/* packages (e.g. pino), which tsup would otherwise
  // bundle because they are not listed in the service's own package.json.
  external: [/^(?!@buku\/)(?![./])/],
});
