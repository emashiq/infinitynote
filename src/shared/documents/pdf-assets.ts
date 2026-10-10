/**
 * pdf.js files the app ships next to the renderer (D-128): the worker, WebAssembly decoders, character maps, standard
 * fonts and ICC profiles live under this folder of the built renderer, so they load offline from the app itself.
 */
export const PDFJS_ASSETS_DIR = 'pdfjs';
/** The worker module, relative to the assets folder. */
export const PDFJS_WORKER_FILE = 'pdf.worker.min.mjs';
