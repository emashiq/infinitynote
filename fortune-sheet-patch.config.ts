import fs from 'node:fs';
import type { Plugin } from 'vite';

/**
 * FortuneSheet 1.0.4 inserts copied rows with `new Function("d", "return d.splice(…)")` (D-123), which the app's CSP
 * blocks (no `unsafe-eval`), so inserting rows would fail. This build step replaces those three statements with a call
 * of `insertRowsAt` (MIT allows the change), for the production bundle (a Vite transform) and for the development
 * server's dependency bundle (an esbuild plugin). It fails the build when the code it expects is not there, so an
 * upgrade cannot silently bring the eval back (D-139).
 */

/**
 * Inserts rows given as JSON strings into `d` at `index`: what the generated function did, without eval. Rows go in
 * batches, so inserting many rows stays within the engine's argument limit.
 */
export function insertRowsAt(d: unknown[], index: number, rows: string[]): void {
  const parsed = rows.map((row) => JSON.parse(row) as unknown);
  for (let i = 0; i < parsed.length; i += 10000) d.splice(index + i, 0, ...parsed.slice(i, i + 10000));
}

const HELPER = '__infinityInsertRowsAt';

/** The statements as FortuneSheet 1.0.4 has them (both the ESM and the CommonJS build), and what replaces each. */
const REPLACEMENTS: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'new Function("d", "return d.unshift(".concat(arr.join(","), ")"))(d);', to: `${HELPER}(d, 0, arr);` },
  { from: 'new Function("d", "return d.splice(".concat(index, ", 0, ").concat(arr.join(","), ")"))(d);', to: `${HELPER}(d, index, arr);` },
  { from: 'new Function("d", "return d.splice(".concat(index + 1, ", 0, ").concat(arr.join(","), ")"))(d);', to: `${HELPER}(d, index + 1, arr);` },
];

/** The FortuneSheet core module this patches, by file path. */
export const FORTUNE_SHEET_CORE = /[\\/]@fortune-sheet[\\/]core[\\/]dist[\\/]index(\.esm)?\.js$/;

/** FortuneSheet's core module with every `new Function` replaced; throws when the module is not the expected one. */
export function patchFortuneSheetCore(code: string): string {
  let patched = code;
  for (const { from, to } of REPLACEMENTS) {
    if (!patched.includes(from)) throw new Error(`fortune-sheet patch: expected code not found: ${from}`);
    patched = patched.replaceAll(from, to);
  }
  if (/new Function\s*\(/.test(patched)) throw new Error('fortune-sheet patch: the core module still creates functions from strings');
  return `${patched}\nfunction ${HELPER}${insertRowsAt.toString().replace(/^function\s*\w*/, '')}\n`;
}

/** Applies the patch in the renderer build and in the development server's pre-bundled dependencies. */
export function fortuneSheetPatch(): Plugin {
  return {
    name: 'infinity-fortune-sheet-patch',
    enforce: 'pre',
    config: () => ({
      optimizeDeps: {
        esbuildOptions: {
          plugins: [
            {
              name: 'infinity-fortune-sheet-patch',
              setup(build) {
                build.onLoad({ filter: FORTUNE_SHEET_CORE }, async (args) => ({ contents: patchFortuneSheetCore(await fs.promises.readFile(args.path, 'utf8')), loader: 'js' }));
              },
            },
          ],
        },
      },
    }),
    transform(code, id) {
      return FORTUNE_SHEET_CORE.test(id.split('?')[0] ?? '') ? { code: patchFortuneSheetCore(code), map: null } : null;
    },
  };
}
