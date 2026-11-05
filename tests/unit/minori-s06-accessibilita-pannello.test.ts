import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S06 · 235 — Nel pannello del negozio campi e filtri si fanno capire al lettore di schermo.
 * (Le percentuali della promo sono in minori-s06-promozioni, i filtri dei clienti qui.)
 */
const leggi = (p: string) => readFileSync(p, 'utf8');

describe('235 — accessibilità del pannello', () => {
  it('recensioni: filtri per stelle con aria-pressed e campo risposta con etichetta', () => {
    const s = leggi('app/seller/reviews/page.tsx');
    expect(s).toContain('aria-pressed={filter === star}');
    expect(s).toContain('aria-label="La tua risposta pubblica alla recensione"');
  });
  it('clienti: i filtri dicono quale è scelto', () => {
    expect(leggi('app/seller/customers/page.tsx')).toContain('aria-pressed={filter === f.key}');
  });
  it('analisi e guadagni: i valori dei grafici ci sono anche in testo', () => {
    for (const p of ['app/seller/analytics/page.tsx', 'app/seller/earnings/page.tsx']) {
      const s = leggi(p);
      expect(s, p).toMatch(/<ul className="sr-only">/);
      expect(s, p).toMatch(/items-end gap-[\d.]+" aria-hidden="true"/);
    }
  });
  it('storie: il cestino è almeno 44×44', () => {
    const s = leggi('app/seller/stories/page.tsx');
    expect(s).toMatch(/h-11 w-11[^"]*"\s+aria-label="Elimina storia"/);
  });
});
