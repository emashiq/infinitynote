import { defineConfig } from '@playwright/test';

/** Installed-build checks; driven by tools/verify-windows-install.mjs, never part of test:e2e. */
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '../../test-results/install',
  reporter: [['list']],
});
