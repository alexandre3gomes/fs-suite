const base = require('./base');

// React Native compatible config — no React DOM specific plugins required.
// eslint-plugin-react is intentionally omitted: the project targets React Native
// (Expo Router) which does not use React DOM. JSX transform is automatic via
// babel-preset-expo, so react/react-in-jsx-scope is not applicable.

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [...base];
