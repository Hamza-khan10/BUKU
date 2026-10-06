// Conventional Commits: <type>(<scope>): <description>
// Scopes are the monorepo workspaces plus a few cross-cutting areas, so the
// commit log tells you *which part* of the system changed.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'ci', 'build', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        // packages
        'common',
        'database',
        'kafka',
        // services
        'auth',
        'business',
        'booking',
        'queue',
        'billing',
        'notification',
        'search',
        'ads',
        'analytics',
        // apps (phase 3/4)
        'web',
        'admin',
        'mobile',
        // cross-cutting
        'infra',
        'docker',
        'kong',
        'ci',
        'deps',
        'docs',
        'repo',
        'security',
        'release',
      ],
    ],
    'scope-empty': [1, 'never'],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
};
