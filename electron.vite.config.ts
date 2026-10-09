import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { moduleAliases } from './aliases.config';
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
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
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
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
    plugins: [react(), cspMeta()],
  },
});
