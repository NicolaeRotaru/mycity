/**
 * R06-005 (12/11/2026) — LA REGOLA CHE VIETA I TIPI «QUALUNQUE» NON ERA ACCESA.
 *
 * Nella configurazione calcolata di eslint @typescript-eslint/no-explicit-any
 * non c'era: un `as any` nuovo su un oggetto dei soldi passava lint e typecheck
 * senza avviso. Ora e' accesa almeno come avviso su ogni file TypeScript.
 * (Le direttive eslint-disable morte stanno in file di altre sessioni: sono nel
 * referto R06, non qui.)
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

// eslint non porta i suoi tipi in questa casa: si carica con require.
type Configurazione = { rules?: Record<string, unknown> };
const { ESLint } = createRequire(import.meta.url)('eslint') as {
  ESLint: new (o: { cwd: string }) => { calculateConfigForFile(f: string): Promise<Configurazione> };
};

const RADICE = path.resolve(__dirname, '../..');

describe('R06-005 · no-explicit-any acceso', () => {
  for (const file of ['lib/env.ts', 'app/admin/page.tsx', 'lib/stripe/webhook/comune.ts']) {
    it(`vale su ${file}`, async () => {
      const eslint = new ESLint({ cwd: RADICE });
      const config = await eslint.calculateConfigForFile(path.join(RADICE, file));
      const regola = config.rules?.['@typescript-eslint/no-explicit-any'];
      const livello = Array.isArray(regola) ? regola[0] : regola;
      expect(livello, 'La regola che vieta i tipi «qualunque» non e\' accesa').toBeDefined();
      expect(['warn', 'error', 1, 2]).toContain(livello);
    }, 60000);
  }
});
