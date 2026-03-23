/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: [require.resolve('./base.js')],
  env: {
    node: true,
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'error',
  },
};
