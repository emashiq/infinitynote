import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { moduleAliases } from './aliases.config';
import { fortuneSheetPatch } from './fortune-sheet-patch.config';

export default defineConfig({
  // The spreadsheet viewer runs on FortuneSheet's core as the app builds it (patched, D-139, D-184).
  plugins: [react(), fortuneSheetPatch()],
  resolve: { alias: moduleAliases(__dirname) },
  test: {
    // Main reads the design tokens as raw text (D-097); Vitest returns other CSS as empty modules.
    css: { include: [/shared[\\/]theme[\\/]tokens\.css/] },
    // Transformed by Vite (not loaded as is by Node), so the patch above applies to it.
    server: { deps: { inline: [/@fortune-sheet[\\/]core/] } },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          // GitHub's Windows runners have slow disks: 1,000-row transactional tests need far more than 30 s there.
          testTimeout: process.env.CI ? 180_000 : 30_000,
        },
      },
    ],
  },
});
