/**
 * Web counterpart of `appFonts.ts`. Archivo arrives through the `@import` in
 * `global.css`, so nothing is registered here and no `.ttf` reaches the web
 * bundle. Kept as a static platform split — dynamic `import()` chunks fail
 * under the Expo web dev server.
 */
export const appFonts = {};
