import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { metricheVenditore } from '@/lib/metriche-venditore';
import { nettoDopoStorni } from '@/lib/guadagni/negozio';

/**
 * S01 — 257 e 2351: «Il tuo netto» del cruscotto e la pagina Guadagni dicono
 * la stessa cifra sullo stesso ordine.
 */
const base = {
  delivery_status: 'DELIVERED',
  payment_status: 'PARTIALLY_REFUNDED',
  created_at: '2026-11-03T10:00:00.000Z',
};

describe('257 — dopo un rimborso parziale il netto è quello che il negozio riceve', () => {
  it('ordine da 20 €: netto 16,50, rimborso di 5 € che riprende al negozio 4,13 → 12,37', () => {
    const o = {
      ...base, total_price: 20, application_fee_cents: 150, shipping_cost: 0, delivery_fee_cents: 300,
      refunded_amount_cents: 500, seller_payout_cents: 1650, seller_payout_reversed_cents: 413,
    };
    expect(metricheVenditore([o]).tuoNettoCents).toBe(nettoDopoStorni(o as never));
    expect(metricheVenditore([o]).tuoNettoCents).toBe(1237);
  });
});

describe('2351 — l\'euro della veloce reso dal freno non si toglie due volte', () => {
  it('19 € con veloce, 1 € reso senza toccare il negozio: il netto resta 13,50', () => {
    const o = {
      ...base, total_price: 19, application_fee_cents: 150, shipping_cost: 0, delivery_fee_cents: 400,
      refunded_amount_cents: 100, seller_payout_cents: 1350, seller_payout_reversed_cents: 0,
    };
    expect(metricheVenditore([o]).tuoNettoCents).toBe(1350);
  });
});

describe('ordini senza netto scritto: la regola di prima', () => {
  it('incassato meno commissione e consegna', () => {
    const o = { ...base, payment_status: 'PAID', total_price: 20, application_fee_cents: 150, shipping_cost: 0, delivery_fee_cents: 300 };
    expect(metricheVenditore([o]).tuoNettoCents).toBe(1550);
  });
  it('cruscotto e Analisi leggono il netto scritto sull\'ordine', () => {
    for (const p of ['app/seller/dashboard/page.tsx', 'app/seller/analytics/page.tsx']) {
      expect(readFileSync(p, 'utf8')).toContain('seller_payout_cents, seller_payout_reversed_cents, created_at');
    }
  });
});
