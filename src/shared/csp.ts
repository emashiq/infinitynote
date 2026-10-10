export const PROD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob: data:; font-src 'self'; connect-src 'self' infinity-document:; object-src 'none'; worker-src 'self'; frame-src infinity-html:; base-uri 'none'; form-action 'none'";

export const DEV_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob: data:; font-src 'self'; connect-src 'self' infinity-document: ws://localhost:* http://localhost:*; object-src 'none'; worker-src 'self'; frame-src infinity-html:; base-uri 'none'; form-action 'none'";

/**
 * The policy of an HTML document in the viewer frame (D-118): no script, no network, no plugins, no forms; only inline
 * styles and images embedded as data URLs (or from the same scheme, which serves nothing but the page itself). The
 * `sandbox` directive keeps the page sandboxed even if it were ever loaded outside the frame.
 */
export const HTML_DOCUMENT_CSP = "default-src 'none'; img-src data: infinity-html:; style-src 'unsafe-inline' infinity-html:; base-uri 'none'; form-action 'none'; sandbox";

/**
 * The policy of the pdf.js worker and its files (D-128), sent by the renderer protocol for everything under `pdfjs/`.
 * A worker keeps the policy of its own script, not the page's. pdf.js decodes JPEG 2000, JBIG2 and ICC colors and
 * compiles PostScript functions with WebAssembly in the worker, so `'wasm-unsafe-eval'` is allowed there and nowhere
 * else: the worker has no DOM, no bridge and no network beyond the app itself, and JavaScript eval stays blocked.
 */
export const PDF_WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";
