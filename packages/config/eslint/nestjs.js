const base = require('./base');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // NestJS DI tokens are class constructors emitted via reflect-metadata.
      // Forcing 'import type' would break DI injection at runtime, so the rule
      // is disabled for NestJS files where emitDecoratorMetadata is true.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
