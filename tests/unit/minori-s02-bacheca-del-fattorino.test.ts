import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Sessione S02 (5/11/2026) — la bacheca del fattorino (lettura del sorgente: il banco che monta la
 * bacheca, in gli-ordini-sanno-il-negozio-con-i-profili-chiusi, resta verde con queste modifiche).
 *  · 1709: niente «Giro intelligente · +15% efficienza» inventato;
 *  · 423:  la lettura caduta degli ordini liberi si dice («Non riesco a leggere gli ordini disponibili»);
 *  · 1741: «i miei ordini» si leggono solo aperti, non tutta la storia ogni minuto;
 *  · 326:  tutte le consegne prese, non solo la prima.
 */
const src = readFileSync('app/rider/page.tsx', 'utf8');

describe('la bacheca del fattorino', () => {
  it('1709 · niente giro intelligente né percentuali scritte a mano', () => {
    expect(src).not.toMatch(/\+15% efficienza|Giro intelligente ·|available\.slice\(0, 2\)/);
  });

  it('423 · un errore della vista diventa un avviso con Riprova, non «nessun ordine pronto»', () => {
    expect(src).toContain('bachecaGuasta: !!bacheca.error');
    expect(src).toContain('Non riesco a leggere gli ordini disponibili');
    expect(src).toContain('available.length === 0 && bachecaGuasta ? null');
  });

  it('1741 · i miei ordini si leggono solo aperti', () => {
    const lettura = src.slice(src.indexOf(".from('orders')"), src.indexOf("if (miei.error) throw miei.error;"));
    expect(lettura).toContain(".in('delivery_status', STATI_DELLE_MIE_CONSEGNE_APERTE)");
    expect(src).toMatch(/STATI_DELLE_MIE_CONSEGNE_APERTE = \[[^\]]*'OUT_FOR_DELIVERY'[^\]]*\]/);
    expect(src).not.toMatch(/STATI_DELLE_MIE_CONSEGNE_APERTE = \[[^\]]*'DELIVERED'/);
  });

  it('326 · tutte le consegne attive, non activeOne = myActive[0]', () => {
    expect(src).not.toContain('myActive[0]');
    expect(src).toContain('myActive.map((activeOne) => (');
  });
});

describe('2178 · le prove della fascia che mancavano', () => {
  it('la bacheca mette la fascia anche sugli ordini in preparazione', () => {
    const blocco = src.slice(src.indexOf('{inPrep.map((o) => ('), src.indexOf('{inPrep.map((o) => (') + 1500);
    expect(blocco).toContain('<RigaFascia ordine={o} />');
  });

  it('«Domani» si conta dal giorno di Piacenza in cui l ordine è nato, anche a cavallo della mezzanotte e del mese', async () => {
    const { fasciaLeggibile } = await import('@/lib/ordini/fascia-leggibile');
    // Venerdì 30/10 alle 21:15 di Piacenza (20:15 UTC): domani è sabato 31/10.
    expect(fasciaLeggibile({ delivery_slot: 'Domani · 9:00–12:00', created_at: '2026-10-30T20:15:00Z' })).toBe('sab 31/10 · 9:00–12:00');
    // Sabato 31/10 alle 00:30 di Piacenza (23:30 UTC del 30/10): il giorno di nascita è il 31, domani è il 1/11.
    expect(fasciaLeggibile({ delivery_slot: 'Domani · 9:00–12:00', created_at: '2026-10-30T23:30:00Z' })).toBe('dom 1/11 · 9:00–12:00');
    // «Oggi» resta il giorno di nascita.
    expect(fasciaLeggibile({ delivery_slot: 'Oggi · 13:00–16:30', created_at: '2026-11-02T11:00:00Z' })).toBe('lun 2/11 · 13:00–16:30');
  });
});
