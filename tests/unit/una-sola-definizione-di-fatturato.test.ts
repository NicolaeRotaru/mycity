import { describe, it, expect } from 'vitest';
import { metricheVenditore, ordineContaNelFatturato } from '@/lib/metriche-venditore';

/**
 * Tre pagine del venditore, tre numeri diversi per lo stesso mese.
 *
 *   · Riepilogo → sommava prezzo × quantità di TUTTI gli articoli, annullati e
 *     non pagati compresi: il numero più alto, quello che si guarda con piacere
 *   · Andamento → sommava il totale degli ordini consegnati, spedizione e quota
 *     di consegna comprese: soldi che in parte non sono del negozio
 *   · Incassi   → totale meno la commissione: l'unico vicino a quello che arriva
 *     in banca
 *
 * Con tre numeri il negoziante non sa a quale credere. Qui si prova che la
 * definizione è una, e quale.
 */

const ordinePagato = {
  total_price: 100,          // il cliente ha pagato 100
  delivery_status: 'DELIVERED',
  payment_status: 'PAID',
  application_fee_cents: 850, // commissione 8,50 (10% del subtotale 85)
  shipping_cost: 5,           // 5 al fattorino
  delivery_fee_cents: 300,    // 3 alla piattaforma
  created_at: '2026-08-10T10:00:00Z',
};

describe('quali ordini contano', () => {
  it('un ordine annullato non e fatturato di nessuno', () => {
    expect(ordineContaNelFatturato({ ...ordinePagato, delivery_status: 'CANCELED' })).toBe(false);
  });

  it('un ordine non pagato non conta', () => {
    expect(ordineContaNelFatturato({ ...ordinePagato, payment_status: 'PENDING' })).toBe(false);
  });

  it('un ordine pagato e in corso conta', () => {
    expect(ordineContaNelFatturato({ ...ordinePagato, delivery_status: 'READY' })).toBe(true);
  });

  it('un rimborso parziale conta ancora', () => {
    expect(ordineContaNelFatturato({ ...ordinePagato, payment_status: 'PARTIALLY_REFUNDED' })).toBe(true);
  });
});

describe('quanto resta al negozio', () => {
  it('toglie commissione, spedizione e quota di consegna', () => {
    const m = metricheVenditore([ordinePagato]);
    expect(m.ordini).toBe(1);
    expect(m.incassatoCents).toBe(10_000);
    expect(m.commissioneCents).toBe(850);
    // 10000 − 850 (commissione) − 500 (spedizione) − 300 (consegna) = 8350
    expect(m.tuoNettoCents).toBe(8350);
  });

  it('non conta gli annullati insieme ai buoni', () => {
    const m = metricheVenditore([
      ordinePagato,
      { ...ordinePagato, delivery_status: 'CANCELED' },
      { ...ordinePagato, payment_status: 'PENDING' },
    ]);
    expect(m.ordini).toBe(1);
    expect(m.tuoNettoCents).toBe(8350);
  });

  it('filtra per data quando glielo si chiede', () => {
    const vecchio = { ...ordinePagato, created_at: '2026-01-01T10:00:00Z' };
    const tutti = metricheVenditore([ordinePagato, vecchio]);
    const soloRecenti = metricheVenditore([ordinePagato, vecchio], new Date('2026-08-01T00:00:00Z'));
    expect(tutti.ordini).toBe(2);
    expect(soloRecenti.ordini).toBe(1);
  });

  it('non va sotto zero su un ordine tutto spedizione', () => {
    const m = metricheVenditore([{
      total_price: 5, delivery_status: 'DELIVERED', payment_status: 'PAID',
      application_fee_cents: 0, shipping_cost: 5, delivery_fee_cents: 300,
      created_at: '2026-08-10T10:00:00Z',
    }]);
    expect(m.tuoNettoCents).toBe(0);
  });

  it('senza ordini non inventa numeri', () => {
    const m = metricheVenditore([]);
    expect(m).toEqual({ ordini: 0, incassatoCents: 0, commissioneCents: 0, tuoNettoCents: 0 });
  });
});
