// Web-only pdf.js loader. Imported statically (not via dynamic `import()`) so it
// lands in the main web bundle — Metro's dev server fails to serve async
// `import()` chunks for web (returns them as application/json), which breaks the
// chart viewer under `expo start`. The native counterpart (pdfjs-loader.ts) is a
// stub, so pdf.js never enters the native bundle.
import * as pdfjs from 'pdfjs-dist';

import type { PdfjsApi } from './pdfjs-types';

let configured = false;

export function getPdfjs(): PdfjsApi {
  if (!configured) {
    // Worker from unpkg, pinned to the bundled version (same pattern as
    // Leaflet's CSS in AerodromeMap).
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    configured = true;
  }
  return pdfjs as unknown as PdfjsApi;
}
