import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { PDFJS_ASSETS_DIR, PDFJS_WORKER_FILE } from './src/shared/documents/pdf-assets';

/**
 * The pdf.js files the PDF viewer loads at run time (D-128), copied from the package: the worker, the WebAssembly image
 * decoders with their JavaScript fallbacks and licenses (the QuickJS scripting sandbox is left out: scripting is off),
 * character maps, standard fonts and ICC profiles.
 */
function assetFiles(packageDir: string): Array<{ from: string; to: string }> {
  const dir = (name: string, keep: (file: string) => boolean = () => true) =>
    fs
      .readdirSync(path.join(packageDir, name))
      .filter(keep)
      .map((file) => ({ from: path.join(packageDir, name, file), to: `${name}/${file}` }));
  return [
    { from: path.join(packageDir, 'build', PDFJS_WORKER_FILE), to: PDFJS_WORKER_FILE },
    ...dir('wasm', (file) => !file.startsWith('quickjs')),
    ...dir('cmaps'),
    ...dir('standard_fonts'),
    ...dir('iccs'),
  ];
}

/** Emits the pdf.js run-time files under `pdfjs/` of the renderer build and serves them there in development. */
export function pdfjsAssets(root: string): Plugin {
  const packageDir = path.join(root, 'node_modules', 'pdfjs-dist');
  return {
    name: 'infinity-pdfjs-assets',
    configureServer(server) {
      const files = new Map(assetFiles(packageDir).map((f) => [`/${PDFJS_ASSETS_DIR}/${f.to}`, f.from]));
      server.middlewares.use((req, res, next) => {
        const file = files.get((req.url ?? '').split('?')[0] ?? '');
        if (!file) return next();
        res.setHeader('Content-Type', file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const file of assetFiles(packageDir)) {
        this.emitFile({ type: 'asset', fileName: `${PDFJS_ASSETS_DIR}/${file.to}`, source: fs.readFileSync(file.from) });
      }
    },
  };
}
