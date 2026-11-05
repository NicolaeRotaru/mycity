import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAGINA_ATTESA_NEGOZIO } from '@/lib/auth/decisione-portiere';

/**
 * S10 (5/11/2026, scheda 2118) — la pagina d'attesa del negozio e il tipo dei
 * ruoli hanno una fonte sola.
 */
describe('una fonte sola per la pagina d\'attesa del negozio (2118)', () => {
  it('il portiere non riscrive l\'indirizzo a mano', () => {
    const src = readFileSync('middleware.ts', 'utf8');
    expect(src).not.toMatch(/url\.pathname = '\/seller\/dashboard'/);
    expect(src.match(/url\.pathname = PAGINA_ATTESA_NEGOZIO/g) ?? []).toHaveLength(2);
    expect(PAGINA_ATTESA_NEGOZIO).toBe('/seller/dashboard');
  });
  it('RuoloArea è ProfileRole, non una copia', () => {
    const src = readFileSync('lib/auth/decisione-portiere.ts', 'utf8');
    expect(src).toMatch(/export type RuoloArea = ProfileRole;/);
  });
});
