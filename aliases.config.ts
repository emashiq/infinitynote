import { resolve } from 'node:path';

/**
 * Module aliases shared by the electron-vite build and Vitest. Vite's exports resolver reads chrono-node's `./*\/*`
 * export pattern with an unescaped second `*` and maps `chrono-node/en` to a file that does not exist, so the English
 * entry is named directly: the package's own ESM build of `chrono-node/en` (D-096). Node resolves it the same way.
 */
export function moduleAliases(root: string): Array<{ find: RegExp; replacement: string }> {
  return [{ find: /^chrono-node\/en$/, replacement: resolve(root, 'node_modules/chrono-node/dist/esm/locales/en/index.js') }];
}
