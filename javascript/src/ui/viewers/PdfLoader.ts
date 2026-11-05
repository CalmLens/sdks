/// <reference path="./pdfjs.d.ts" />
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfAssetOptions } from "./ViewerAsset";

export type PdfJs = typeof import("pdfjs-dist");
export type PdfDocument = PDFDocumentProxy;

let loading: Promise<PdfJs> | undefined;

/**
 * Loads pdf.js, the first time a document viewer needs it: never at import, so pages without
 * documents never download it. With `workerSrc`, pdf.js reads documents in a worker loaded from
 * your app; otherwise its worker module is imported too and reads them on the main thread.
 */
export const loadPdfJs = (options: PdfAssetOptions = {}): Promise<PdfJs> => {
  loading ??= (async () => {
    const pdfjs = await import("pdfjs-dist");
    if (options.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
    else {
      // pdf.js reads documents on the main thread through the worker module it finds here.
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    }
    return pdfjs;
  })().catch((error) => {
    // A failed download (offline, a stale deploy) may work next time.
    loading = undefined;
    throw error;
  });
  return loading;
};

/** Opens a document from its URL with pdf.js. */
export const openPdfDocument = async (
  url: string,
  options: PdfAssetOptions = {},
): Promise<PdfDocument> => {
  const pdfjs = await loadPdfJs(options);
  const task = pdfjs.getDocument({
    url,
    standardFontDataUrl: options.standardFontDataUrl,
    cMapUrl: options.cMapUrl,
    cMapPacked: options.cMapUrl ? true : undefined,
    wasmUrl: options.wasmUrl,
    // Only errors: warnings about missing fonts or decoders aren't the app's to fix.
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  return await task.promise;
};
