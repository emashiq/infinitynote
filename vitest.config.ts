import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { moduleAliases } from './aliases.config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: moduleAliases(__dirname) },
  test: {
    // Main reads the design tokens as raw text (D-097); Vitest returns other CSS as empty modules.
    css: { include: [/shared[\\/]theme[\\/]tokens\.css/] },
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
          testTimeout: 30000,
        },
      },
    ],
  },
});
