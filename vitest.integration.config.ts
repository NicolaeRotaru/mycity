import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config — suite di INTEGRAZIONE (tocca un DB Supabase reale).
 *
 * Separata dagli unit test (vitest.config.ts: puri, niente DB/network) perche'
 * questi test verificano il confine di sicurezza lato database (RLS, grant
 * EXECUTE su SECURITY DEFINER). Girano in CI nel job dedicato con i secret
 * Supabase; si auto-skippano se le env reali mancano (vedi hasEnv nei test).
 *
 * Timeout piu' alto: le chiamate vere a PostgREST hanno latenza di rete.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});
