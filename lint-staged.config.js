export default {
  // Invisible characters (Trojan Source) in any staged text file.
  '*': 'tsx scripts/check-hidden-chars.ts',
  '*.{ts,tsx,js}': ['eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{json,yml,yaml,md,css}': ['prettier --write'],
  // Database v2 has four schemas (DB-010): each staged one formatted by its own path.
  '*.prisma': (files) => files.map((f) => `pnpm --filter @buku/database exec prisma format --schema ${f}`),
};
