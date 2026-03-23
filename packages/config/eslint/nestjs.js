const base = require('./base');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
];
