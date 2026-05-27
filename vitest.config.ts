import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config — unit test fast-path.
 *
 * Esperti:
 * - Senior Test Engineer: "Unit test = puri, isolati, niente DB / network.
 *   Per testare API/integrazione usa Playwright (vedi tests/e2e/)."
 */

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'tests/sql/**', 'node_modules/**'],
    environment: 'node',
    globals: false,
    testTimeout: 5000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});
