// Native stub — the chart viewer is web-only, so pdf.js is never bundled for
// iOS/Android. The web implementation lives in pdfjs-loader.web.ts.
import type { PdfjsApi } from './pdfjs-types';

export function getPdfjs(): PdfjsApi {
  throw new Error('pdf.js is web-only');
}
