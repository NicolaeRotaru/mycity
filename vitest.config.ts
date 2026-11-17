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
  // Le prove devono saper leggere il JSX dei componenti. tsconfig.json tiene
  // "jsx": "preserve" perché serve a Next.js, e vite lo erediterebbe: allora
  // qualunque prova che tocca un .tsx si ferma prima di partire. Qui diciamo
  // a vite 8 (che trasforma il codice con oxc) di tradurre il JSX da solo.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'tests/sql/**', 'node_modules/**'],
    environment: 'node',
    globals: false,
    // 17/11/2026 (R30-021) — 15 s, non 5. Il primo caso di un file che monta un componente
    // paga la prima compilazione di react, react-dom e delle icone: sotto carico (la suite
    // intera, ~1600 file in parallelo) passava i 5 s e cadeva a caso, in un file diverso
    // ogni volta. Un caso davvero bloccato si ferma lo stesso, dopo 15 s.
    testTimeout: 15000,
    // Vale per OGNI prova unitaria: niente rete, e le variabili d'ambiente tornano
    // come le ha trovate. Il perché sta in testa al file.
    setupFiles: ['tests/unit/_setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});
