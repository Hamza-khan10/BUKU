export default {
  // Invisible characters (Trojan Source) in any staged text file.
  '*': 'tsx scripts/check-hidden-chars.ts',
  // --no-warn-ignored: files ESLint is told to skip (this branch's marketing/ tools) aren't warnings.
  '*.{ts,tsx,js}': ['eslint --fix --max-warnings=0 --no-warn-ignored', 'prettier --write'],
  '*.{json,yml,yaml,md,css}': ['prettier --write'],
  // Database v2 has four schemas (DB-010): each staged one formatted by its own path.
  '*.prisma': (files) => files.map((f) => `pnpm --filter @buku/database exec prisma format --schema ${f}`),
};
