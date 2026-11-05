// pdf.js's worker module ships no declarations; the viewer only hands it to pdf.js.
declare module "pdfjs-dist/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
