import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events', 'fs', 'http', 'http2',
  'https', 'net', 'os', 'path', 'process', 'readline', 'stream', 'tls', 'url', 'util', 'vm', 'worker_threads', 'zlib',
];

const nodePatterns = [
  { group: ['node:*'], message: 'Node built-ins are not allowed here.' },
  { group: nodeBuiltins, message: 'Node built-ins are not allowed here.' },
  { group: nodeBuiltins.map((n) => `${n}/*`), message: 'Node built-ins are not allowed here.' },
];

export default tseslint.config(
  {
    ignores: [
      'out/**', 'release/**', 'node_modules/**', 'coverage/**', 'test-results/**', 'playwright-report/**',
      'infinity-notes-claude-pack/**', 'tools/finalize-docs.mjs', '.infinity-work/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'tools/**/*.mjs', 'tests/**/*.ts', '*.config.ts', '*.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'tests/unit/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The renderer must not import electron.' },
            { name: 'better-sqlite3', message: 'The renderer must not import better-sqlite3.' },
          ],
          patterns: [
            ...nodePatterns,
            { group: ['**/main/**', '**/preload/**'], message: 'The renderer must not import main or preload code.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'zod', message: 'The preload must not import zod.' },
            { name: 'better-sqlite3', message: 'The preload must not import better-sqlite3.' },
          ],
          patterns: [
            ...nodePatterns,
            { group: ['**/main/**', '**/renderer/**'], message: 'The preload must not import main or renderer code.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Shared code must not import electron.' },
            { name: 'better-sqlite3', message: 'Shared code must not import better-sqlite3.' },
          ],
          patterns: [
            ...nodePatterns,
            { group: ['**/main/**', '**/renderer/**', '**/preload/**'], message: 'Shared code must not import app layers.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/db/better-sqlite3-driver.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'better-sqlite3', message: 'Only db/better-sqlite3-driver.ts may import better-sqlite3.' }] },
      ],
    },
  },
);
