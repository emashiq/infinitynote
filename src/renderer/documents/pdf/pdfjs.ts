import * as pdfjsLib from 'pdfjs-dist';
import { PDFJS_ASSETS_DIR, PDFJS_WORKER_FILE } from '../../../shared/documents/pdf-assets';

export type PdfLib = typeof pdfjsLib;
export type PdfViewerLib = typeof import('pdfjs-dist/web/pdf_viewer.mjs');
export interface PdfRuntime {
  lib: PdfLib;
  viewer: PdfViewerLib;
}

/** Where a PDF is read from: the document protocol (with ranges), or bytes edited in this tab. */
export type PdfSource = { url: string } | { data: Uint8Array };

/** The pdf.js files shipped with the renderer (D-128), on the app's own origin. */
const assetsBase = (): string => new URL(`${PDFJS_ASSETS_DIR}/`, document.baseURI).href;

let runtime: Promise<PdfRuntime> | null = null;

/**
 * pdf.js and its viewer components, set up once (D-128): the bundled worker, and the library on globalThis, where the
 * viewer components look for it, before they load.
 */
export function loadPdfRuntime(): Promise<PdfRuntime> {
  runtime ??= (async () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${assetsBase()}${PDFJS_WORKER_FILE}`;
    (globalThis as { pdfjsLib?: PdfLib }).pdfjsLib = pdfjsLib;
    return { lib: pdfjsLib, viewer: await import('pdfjs-dist/web/pdf_viewer.mjs') };
  })();
  return runtime;
}

/**
 * How every PDF is opened (D-128): no XFA, no scripting (the app never loads the pdf.js sandbox), local character
 * maps, fonts, decoders and color profiles fetched by the worker. Bytes are copied, because pdf.js takes over the buffer
 * it is given and the viewer keeps its own.
 */
export function documentParams(source: PdfSource, password: string | null): Parameters<PdfLib['getDocument']>[0] {
  const base = assetsBase();
  return {
    ...('url' in source ? { url: source.url } : { data: source.data.slice() }),
    ...(password === null ? {} : { password }),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    useWorkerFetch: true,
    enableXfa: false,
  };
}
