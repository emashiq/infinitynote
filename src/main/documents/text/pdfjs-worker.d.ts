// The legacy pdf.js worker module ships without types; the PDF text worker only hands it to pdf.js (D-129).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
