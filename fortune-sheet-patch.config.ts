import fs from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Build-time changes to FortuneSheet 1.0.4's core module (MIT allows them), for the production bundle (a Vite
 * transform), the development server's dependency bundle (an esbuild plugin) and the unit tests. Each fails the build
 * when the code it expects is not there, so an upgrade cannot silently undo it.
 *
 * 1. Copied rows are inserted with `new Function("d", "return d.splice(…)")` (D-123), which the app's CSP blocks (no
 *    `unsafe-eval`); those three statements become a call of `insertRowsAt` (D-139).
 * 2. Typed text is read as a number, date or text by `genarate`, which knows only `yyyy-mm-dd` and `yyyy/mm/dd` dates
 *    (D-184). A hook goes in front of it: `setTextValueParser(parse)` lets the app read the text first (as a date in the
 *    computer's date order); `parse` returns FortuneSheet's `[shown, cellType, value]`, or null to leave the text to it.
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

/** FortuneSheet's own text reader, renamed so the hooked `genarate` can call it. */
const GENARATE = 'function genarate(value) {';
const ORIGINAL_GENARATE = '__infinityFortuneGenarate';

/** The hooked `genarate` and the setter of its parser; every caller inside the module (and its export) gets this one. */
const TEXT_VALUE_HOOK = `
var __infinityTextValue = null;
function genarate(value) {
  var own = __infinityTextValue !== null && typeof value === "string" ? __infinityTextValue(value) : null;
  return own !== null ? own : ${ORIGINAL_GENARATE}(value);
}
function __infinitySetTextValueParser(parse) {
  __infinityTextValue = parse;
}
`;

/** The core module this patches, by file path. */
export const FORTUNE_SHEET_CORE = /[\\/]@fortune-sheet[\\/]core[\\/]dist[\\/]index(\.esm)?\.js$/;

function replaceOnce(code: string, from: string, to: string): string {
  const at = code.indexOf(from);
  if (at < 0 || code.indexOf(from, at + from.length) >= 0) throw new Error(`fortune-sheet patch: expected code once: ${from}`);
  return code.slice(0, at) + to + code.slice(at + from.length);
}

/** FortuneSheet's core module with every `new Function` replaced and the text hook added; throws for another module. */
export function patchFortuneSheetCore(code: string): string {
  let patched = code;
  for (const { from, to } of REPLACEMENTS) {
    if (!patched.includes(from)) throw new Error(`fortune-sheet patch: expected code not found: ${from}`);
    patched = patched.replaceAll(from, to);
  }
  if (/new Function\s*\(/.test(patched)) throw new Error('fortune-sheet patch: the core module still creates functions from strings');
  patched = replaceOnce(patched, GENARATE, `function ${ORIGINAL_GENARATE}(value) {`);
  const esm = /^export \{/m.test(patched);
  const exportHook = esm
    ? 'export { __infinitySetTextValueParser as setTextValueParser };'
    : 'exports.setTextValueParser = __infinitySetTextValueParser;';
  return `${patched}\nfunction ${HELPER}${insertRowsAt.toString().replace(/^function\s*\w*/, '')}\n${TEXT_VALUE_HOOK}${exportHook}\n`;
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
