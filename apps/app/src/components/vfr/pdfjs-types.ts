import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Minimal surface of pdf.js used by the chart viewer. */
export interface PdfjsApi {
  version: string;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { url: string; withCredentials?: boolean }): { promise: Promise<PDFDocumentProxy> };
}
