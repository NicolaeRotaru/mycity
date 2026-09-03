import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiSuccess } from '@/lib/api/responses';
import { leggiOrdiniCod } from '@/lib/ordini/risposta-ordini-cod';

/**
 * L'ORDINE PAGATO ALLA CONSEGNA NON ARRIVAVA MAI A GOOGLE ANALYTICS.
 *
 * La rotta risponde `{ ok: true, data: { orderIds, ordini } }`. In cassa gli
 * identificativi si leggevano dentro `data`, l'elenco degli ordini era rimasto
 * in cima al corpo: su un ordine nuovo era sempre vuoto, il ciclo che manda
 * l'acquisto a Google non girava mai. Un ordine da 12,50 € in contanti compare
 * nel database e in PostHog, e su GA4 non esiste: il ritorno delle campagne
 * sembra peggiore del vero.
 *
 * Qui la risposta la costruisce `apiSuccess` VERO, quello della rotta: se
 * l'involucro cambia, questa prova se ne accorge.
 */

const ordini = [
  { id: 'o1', sellerId: 'pane-quotidiano', totalCents: 1250 },
  { id: 'o2', sellerId: 'fioraio', totalCents: 900 },
];

describe('la cassa legge gli ordini dalla forma vera della risposta', () => {
  it('risposta con l’involucro del progetto: gli ordini si trovano', async () => {
    const corpo = await apiSuccess({ orderIds: ordini.map((o) => o.id), ordini }).json();
    const letto = leggiOrdiniCod(corpo);
    expect(letto.orderIds).toEqual(['o1', 'o2']);
    expect(letto.ordini).toHaveLength(2);
    // Il totale mandato a Google è quello del server, ordine per ordine.
    expect(letto.ordini.map((o) => o.totalCents)).toEqual([1250, 900]);
  });

  it('risposta del ramo «invio ripetuto», che è ancora nuda: si trovano lo stesso', () => {
    const letto = leggiOrdiniCod({ orderIds: ['o1'], ordini: [ordini[0]], ripetuto: true });
    expect(letto.orderIds).toEqual(['o1']);
    expect(letto.ordini).toHaveLength(1);
  });

  it('corpo vuoto o rotto: nessun evento inventato', () => {
    expect(leggiOrdiniCod(null)).toEqual({ orderIds: [], ordini: [] });
    expect(leggiOrdiniCod({})).toEqual({ orderIds: [], ordini: [] });
    expect(leggiOrdiniCod({ data: { ordini: 'boh' } })).toEqual({ orderIds: [], ordini: [] });
  });
});

describe('in cassa la lettura non si riscrive più a mano', () => {
  const src = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8');

  it('il checkout usa la lettura condivisa', () => {
    expect(src).toContain('leggiOrdiniCod(');
  });

  it('e non ripesca gli ordini in cima al corpo', () => {
    // È la riga che ha prodotto il difetto: `(body as {...}).ordini ?? []`.
    expect(src).not.toMatch(/\)\.ordini\s*\?\?\s*\[\]/);
  });

  it('l’evento dell’acquisto parte per ogni ordine letto', () => {
    expect(src).toMatch(/for \(const o of ordiniVeri\)/);
    expect(src).toMatch(/trackOrderPlaced\(o\.id, o\.totalCents, 'cod', o\.sellerId/);
  });
});
