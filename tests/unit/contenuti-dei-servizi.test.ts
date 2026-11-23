import { describe, it, expect } from 'vitest';
import { bozzaSito, indirizzoSuggerito, pianoEditoriale } from '@/lib/agenzia/contenuti-servizi';
import { TIPI_ATTIVITA } from '@/lib/agenzia/tipi-attivita';

describe('i contenuti già pronti dei servizi (23/11/2026)', () => {
  it('l indirizzo suggerito toglie accenti, spazi e segni', () => {
    expect(indirizzoSuggerito('Pane Quotidiano')).toBe('panequotidiano.it');
    expect(indirizzoSuggerito("Caffè dell'Università")).toBe('caffedelluniversita.it');
    expect(indirizzoSuggerito('   ')).toBe('latuaattivita.it');
  });

  it('la bozza del sito porta il nome e quattro sezioni', () => {
    const b = bozzaSito('Pane Quotidiano', 'negozio');
    expect(b.nome).toBe('Pane Quotidiano');
    expect(b.sezioni.map((s) => s.titolo)).toEqual(['Chi siamo', 'Cosa offriamo', 'Dove siamo e orari', 'Contatti']);
  });

  it('il piano cade solo di martedì, giovedì e sabato, dentro il mese giusto', () => {
    const p = pianoEditoriale('Bar Roma', 'bar', '2026-12-05');
    expect(p.mese).toBe('dicembre 2026');
    expect(p.post.every((x) => x.data.startsWith('2026-12-'))).toBe(true);
    expect(p.post.every((x) => [2, 4, 6].includes(new Date(`${x.data}T12:00:00Z`).getUTCDay()))).toBe(true);
    expect(p.post.length).toBeGreaterThanOrEqual(12);
    expect(new Set(p.post.map((x) => x.formato))).toEqual(new Set(['Post foto', 'Reel', 'Carosello', 'Storia']));
  });

  it('per ogni tipo di attività gli esempi non promettono prezzi né sconti', () => {
    for (const tipo of TIPI_ATTIVITA) {
      const testi = pianoEditoriale('Prova', tipo, '2026-11-23').post.map((x) => x.esempio).join(' ');
      expect(testi, tipo).not.toMatch(/€|%|sconto|gratis/i);
    }
  });
});
