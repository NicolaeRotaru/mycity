import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 5/11/2026 (S04, scheda 2090) — «Ordine pronto» lo dicono tre canali: l'email (lib/email), la
 * campanella (migrazione 215, provata in tests/sql/rls/48) e il sottotitolo della pagina
 * dell'ordine. L'email dice «un rider passa a prenderlo»; la pagina diceva ancora «un rider sta per
 * ritirarlo», che detto al cliente si confonde col ritiro in negozio.
 */
describe('la pagina dell’ordine pronto', () => {
  it('dice «un rider passa a prenderlo», come l’email e la campanella', () => {
    const pagina = readFileSync('app/orders/[id]/page.tsx', 'utf8');
    const riga = pagina.slice(pagina.indexOf('HERO_SUBTITLE')).split('\n').find((l) => /^\s*READY:\s*'/.test(l)) ?? '';
    expect(riga).toMatch(/un rider passa a prenderlo/);
    expect(riga).not.toMatch(/ritir/);
  });

  it('la campanella della migrazione 215 usa la stessa frase', () => {
    const migrazione = readFileSync('migrations/215_minori_s04_database.sql', 'utf8');
    expect(migrazione).toMatch(/è pronto: un rider passa a prenderlo a breve/);
  });
});
