export default {
  // Invisible characters (Trojan Source) in any staged text file.
  '*': 'tsx scripts/check-hidden-chars.ts',
  '*.{ts,tsx,js}': ['eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{json,yml,yaml,md,css}': ['prettier --write'],
  '*.prisma': () => 'pnpm --filter @buku/database exec prisma format',
};
