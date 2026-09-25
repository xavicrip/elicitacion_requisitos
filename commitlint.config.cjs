/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'repo',
        'web',
        'api',
        'analytics',
        'shared',
        'infra',
        'ci',
        'docs',
        'specs',
        'speckit',
        'lint',
        'e2e',
        'ops',
        'adr',
      ],
    ],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
