// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/database/src/generated/**',
      'apps/*/.next/**',
      'apps/*/next-env.d.ts',
      'apps/*/test-results/**',
      'apps/*/playwright-report/**',
      '.changeset/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A floating promise in a server is an unhandled rejection waiting to crash it.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/only-throw-error': 'error',
      // Security-relevant bans: dynamic code execution and raw process exits in library code.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
    },
  },
  {
    // The web apps (Next.js + React: the website and the admin app): hooks and React Compiler rules, browser globals.
    // (Not the Next.js ESLint plugin: it pulls in a package with an unfixed high advisory,
    // GHSA-vfj7-8cjw-p6xm. Its rule that matters here — internal links through <Link>, so
    // navigation stays client-side and prefetched — is the selector below.)
    files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXOpeningElement[name.name='a'] > JSXAttribute[name.name='href'] > Literal[value=/^\\/(?!\\/)/]",
          message: 'Link to pages of this site with <Link> from next/link.',
        },
      ],
    },
  },
  {
    // Scripts and seeds are CLI entrypoints: console output is their interface.
    files: ['**/scripts/**', '**/prisma/seed*.ts', '*.config.js'],
    rules: { 'no-console': 'off' },
  },
  {
    // HTTP response bodies in tests are untyped (supertest); production code stays strict.
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
