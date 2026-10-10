import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { moduleAliases } from './aliases.config';
import { fortuneSheetPatch } from './fortune-sheet-patch.config';
import { pdfjsAssets } from './pdfjs-assets.config';
import { DEV_CSP, PROD_CSP } from './src/shared/csp';

function cspMeta(): Plugin {
  let serving = false;
  return {
    name: 'infinity-csp-meta',
    configResolved(config) {
      serving = config.command === 'serve';
    },
    transformIndexHtml(html) {
      if (!html.includes('<!--CSP-->')) {
        throw new Error('index.html is missing the <!--CSP--> placeholder');
      }
      const csp = serving ? DEV_CSP : PROD_CSP;
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );
    },
  };
}

export default defineConfig({
  main: {
    build: {
      // unzipper (under ExcelJS) requires the S3 client only inside its S3 reader, which the app never calls; left as a
      // lazy require it is never loaded, hoisted it would end the workbook worker at start (D-134).
      commonjsOptions: { ignore: ['@aws-sdk/client-s3'] },
      // The PDF text and workbook workers are their own entries, so pdf.js and ExcelJS load only in those worker threads
      // (D-129, D-134); neither shares a module with index.
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'pdf-text': resolve(__dirname, 'src/main/documents/text/pdf-text.ts'),
          workbook: resolve(__dirname, 'src/main/documents/spreadsheet/workbook-worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    base: './',
    resolve: { alias: moduleAliases(__dirname) },
    build: {
      // electron-vite leaves the renderer unminified by default; the production React build is minified here (F-01-5).
      minify: 'esbuild',
      // Assets are emitted as files: the CSP allows images from the app itself, not data: URLs (D-109).
      assetsInlineLimit: 0,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
    plugins: [react(), cspMeta(), pdfjsAssets(__dirname), fortuneSheetPatch()],
  },
});
