import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ABBANDONATO_DOPO_MS, MESSAGGIO_ORDINE_IN_CORSO, decisioneSuChiaveOccupata } from '@/lib/ordini/tentativo';

/**
 * Sessione S02 (5/11/2026), scheda 2138 — chi ritocca «Ordina» mentre la chiave è occupata
 * aspetta fino a un minuto: il messaggio lo dice, e la prova fissa l'attesa massima.
 */
describe('«ordine già in corso» dice l attesa vera', () => {
  it('l attesa massima è un minuto: a 59 s si aspetta ancora, a 61 s la chiave è abbandonata', () => {
    expect(ABBANDONATO_DOPO_MS).toBe(60_000);
    expect(decisioneSuChiaveOccupata({ ordiniGia: null, natoDaMs: 59_000 })).not.toBe('chiave-abbandonata');
    expect(decisioneSuChiaveOccupata({ ordiniGia: null, natoDaMs: 61_000 })).toBe('chiave-abbandonata');
  });

  it('il messaggio dice «fino a 60 secondi», non «qualche secondo», e la rotta usa quello', () => {
    expect(MESSAGGIO_ORDINE_IN_CORSO).toContain('60 secondi');
    expect(MESSAGGIO_ORDINE_IN_CORSO).not.toContain('qualche secondo');
    const rotta = readFileSync('app/api/orders/cod/route.ts', 'utf8');
    expect(rotta).toContain('message: MESSAGGIO_ORDINE_IN_CORSO');
    expect(rotta).not.toContain("message: 'Ordine già in corso, attendi qualche secondo.'");
  });
});
