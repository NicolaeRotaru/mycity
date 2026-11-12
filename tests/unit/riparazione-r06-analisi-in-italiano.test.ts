/**
 * @vitest-environment jsdom
 */
/**
 * R06-017 (12/11/2026) — LE ETICHETTE DELL'ANALISI ERANO IN INGLESE.
 *
 * «INSIGHT», «RATING MEDIO», «30GG», «stock pronto»: un fornaio capisce poco le
 * parole inglesi e le abbreviazioni. La parte del conto (il voto medio preso
 * dalle recensioni del negozio) sta nella migrazione 302 e nella sua prova SQL
 * (tests/sql/rls/riparazione-r06-analisi-recensioni.test.sql). Qui la pagina si
 * monta con dei numeri in mano e si legge cosa scrive. «Conversion rate» resta:
 * la voce dice che si ripara nella sua voce.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;
afterEach(() => { delete globale.__DATI_QUERY__; delete globale.__UTENTE__; });

const numeri = {
  visiteIgnote: false, views30: 40, views7: 10, viewsToday: 2, orders30: 10, orders7: 3, ordiniRicevuti30: 10,
  revenue30: 124.2, revenue7: 30, conversionRate: 5, avgRating: 3.67, reviewCount: 3,
  topProducts: [{ id: 'p1', name: 'Pane', views: 30, price: 3, images: [] }],
  slowProducts: [{ id: 'p2', name: 'Focaccia', views: 1, price: 4, images: [] }],
  revenueSeries: [], peakHours: [{ hour: 8, count: 4 }], peakLabel: '8:00 e le 9:00',
};

describe('R06-017 · l\'Analisi del negozio parla italiano', () => {
  it('voto medio, consigli, 30 giorni e merce pronta', async () => {
    globale.__UTENTE__ = { id: 'negozio-1' };
    globale.__DATI_QUERY__ = numeri;
    const mod = await monta('app/seller/analytics/page.tsx');
    const s = accendi(mod.default as ComponentType);
    await attendi();
    await attendi();
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Voto medio');
    expect(testo).toContain('3,7');
    expect(testo).toContain('3 recensioni');
    expect(testo).toContain('Consigli');
    expect(testo).toContain('30 giorni');
    expect(testo).toContain('la merce pronta');
    for (const inglese of ['Rating medio', 'Insight', '30gg', '7gg', 'stock pronto']) {
      expect(testo, `La pagina scrive ancora «${inglese}»`).not.toContain(inglese);
    }
    s.smonta();
  }, 60000);
});
