// Babel plugin (scoped to pdfjs-dist via `overrides` below) that rewrites two
// constructs Metro can't handle in its classic-script web bundle:
//
//  1. Dynamic `import(expr)` with a non-static argument — Metro's dependency
//     collector rejects these at build time. pdfjs has one in its fake-worker
//     fallback (`import(this.workerSrc)`), dead code whenever a real Worker is
//     available (we always set a worker URL). Replaced with a rejecting promise.
//  2. `import.meta` — pdfjs uses `import.meta.url` in a Node-only `createRequire`
//     path (never reached in the browser), but the token itself is invalid in a
//     classic script. Replaced with `({ url: '' })`.
//
// Scoped to pdfjs-dist only so our own dynamic imports / import.meta are intact.
function patchPdfjsForMetro({ types: t }) {
  return {
    name: 'patch-pdfjs-for-metro',
    visitor: {
      CallExpression(path) {
        if (path.node.callee.type !== 'Import') return;
        const arg = path.node.arguments[0];
        if (arg && arg.type === 'StringLiteral') return; // keep static imports
        path.replaceWith(
          t.callExpression(
            t.memberExpression(t.identifier('Promise'), t.identifier('reject')),
            [
              t.newExpression(t.identifier('Error'), [
                t.stringLiteral('Dynamic import not supported in this bundle'),
              ]),
            ],
          ),
        );
      },
      MetaProperty(path) {
        if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
          path.replaceWith(
            t.objectExpression([t.objectProperty(t.identifier('url'), t.stringLiteral(''))]),
          );
        }
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // pdfjs-dist (chart viewer) ships static class blocks that Metro transforms
    // but babel-preset-expo doesn't enable by default.
    plugins: ['@babel/plugin-transform-class-static-block'],
    overrides: [
      {
        test: /node_modules[\\/]pdfjs-dist[\\/]/,
        plugins: [patchPdfjsForMetro],
      },
    ],
  };
};
