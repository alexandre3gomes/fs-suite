const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo support: watch workspace root so Metro can follow pnpm symlinks
// into the .pnpm store and resolve packages like expo-router/entry.
config.watchFolders = [workspaceRoot];

// Resolve modules from app-local node_modules first, then workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// --- Singleton resolution for React family packages ---
// In this pnpm monorepo, the root `node_modules/react` and the pnpm store copy
// (`node_modules/.pnpm/react@18.2.0/.../react`) are different physical files.
// Metro treats them as separate modules and bundles both, creating two React
// instances whose dispatchers collide — every hook call crashes with
// "Cannot read properties of null (reading 'useEffect')".
//
// The fix: intercept resolution so that any import of these packages always
// resolves to the app-local copy (via its symlink into the pnpm store).
const singletons = ['react', 'react-dom', 'react-native', 'react-native-web'];
const singletonPaths = {};
for (const name of singletons) {
  const entry = require.resolve(name, { paths: [projectRoot] });
  singletonPaths[name] = fs.realpathSync(path.dirname(entry));
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const name of singletons) {
    if (moduleName === name || moduleName.startsWith(name + '/')) {
      const suffix = moduleName === name ? '' : moduleName.slice(name.length);
      const filePath = path.join(singletonPaths[name], suffix);

      // If this is a bare import (e.g. 'react'), resolve to index.js
      if (!suffix) {
        return { type: 'sourceFile', filePath: path.join(filePath, 'index.js') };
      }
      // Sub-path import (e.g. 'react/jsx-runtime') — try with .js extension
      if (fs.existsSync(filePath + '.js')) {
        return { type: 'sourceFile', filePath: filePath + '.js' };
      }
      if (fs.existsSync(filePath)) {
        return { type: 'sourceFile', filePath };
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
