/**
 * 30/10/2026 (ondata 21) — LA CASSA PASSA GLI ORARI DEI NEGOZI AL SELETTORE E AL FRENO.
 *
 * Il comportamento (giovedì 14:00, lunedì 17:50, la settimana intera) lo provano
 * `la-cassa-propone-solo-fasce-che-il-negozio-puo-servire.test.tsx` e
 * `la-rotta-rifiuta-una-fascia-a-meno-di-un-ora-dalla-fine.test.ts`. Qui si guarda il filo che
 * li collega nella pagina: senza `store_hours` letti e passati, il selettore torna a proporre
 * «Oggi · 15:00–18:00» a un forno chiuso e il freno di «Ordina» non lo ferma.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGINA = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8');

describe('la pagina della cassa e gli orari dei negozi del carrello', () => {
  it('legge store_hours insieme ai negozi del carrello', () => {
    expect(PAGINA).toMatch(/fetchSellerPublicMap\(supabase, allSellerIds, '[^']*\bstore_hours\b/);
  });

  it('li dà al selettore delle fasce', () => {
    expect(PAGINA).toMatch(/<DeliverySlotPicker[\s\S]*?orariNegozi=\{orariNegozi\}[\s\S]*?\/>/);
  });

  it('li dà a ogni controllo di «si può confermare», insieme all\'orologio coi minuti', () => {
    const chiamate = PAGINA.split('consegnaScelta({').slice(1).map((c) => c.slice(0, c.indexOf('});')));
    expect(chiamate.length).toBeGreaterThanOrEqual(2);
    for (const c of chiamate) {
      expect(c).toContain('adesso: romeNow()');
      expect(c).toContain('orari: orariNegozi');
    }
  });

  it('il giorno e la fascia di partenza si calcolano coi minuti, non con l\'ora intera', () => {
    expect(PAGINA).toMatch(/const oraDiApertura = romeNow\(\);/);
  });
});
