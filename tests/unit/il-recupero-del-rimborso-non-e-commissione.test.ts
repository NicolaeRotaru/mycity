import { describe, it, expect } from 'vitest';
import { riepilogoContanti, gruppoDelPannello, type OrdineNegozio } from '@/lib/guadagni/negozio';

/**
 * Sui ritiri pagati al banco il negozio deve a MyCity la commissione e, a parte, il recupero dei
 * rimborsi (la sua quota dei rimborsi che MyCity ha fatto al cliente, al massimo il suo netto).
 * Il riepilogo del negozio e le etichette del pannello li tengono separati: il recupero non è
 * commissione e non va in fattura (999i).
 */

const ritiro = (extra: Partial<OrdineNegozio> = {}): OrdineNegozio => ({
  total_price: 20,
  payment_method: 'cod',
  payout_status: 'CASH_IN_STORE',
  seller_payout_cents: 1800,
  seller_payout_reversed_cents: 0,
  refunded_amount_cents: 0,
  application_fee_cents: 200,
  pickup_in_store: true,
  delivery_status: 'DELIVERED',
  ...extra,
});

describe('il recupero del rimborso sui ritiri al banco', () => {
  it('ritiro da 20 €, commissione 2,00 €, quota stornata 4,50 €: commissione 2,00 €, recupero 4,50 €', () => {
    const r = riepilogoContanti([ritiro({ seller_payout_reversed_cents: 450, refunded_amount_cents: 500 })], () => true);
    expect(r.commissioneDovutaCents).toBe(200);
    expect(r.recuperoRimborsiCents).toBe(450);
  });

  it('il recupero non supera il netto, e un ritiro rimborsato per intero lo porta tutto', () => {
    const r = riepilogoContanti(
      [
        ritiro({ seller_payout_reversed_cents: 2500 }),
        ritiro({ payout_status: 'REFUNDED', seller_payout_reversed_cents: 1800, refunded_amount_cents: 2000 }),
      ],
      () => true,
    );
    expect(r.commissioneDovutaCents).toBe(400);
    expect(r.recuperoRimborsiCents).toBe(3600);
  });

  it('i contanti consegnati dal fattorino non hanno recupero: lo storno lì si toglie dal bonifico', () => {
    const r = riepilogoContanti([ritiro({ payout_status: 'HELD', pickup_in_store: false, seller_payout_reversed_cents: 450 })], () => true);
    expect(r.recuperoRimborsiCents).toBe(0);
  });

  it('il pannello dice «recupero del rimborso» sul ritiro rimborsato, non solo «Rimborsato»', () => {
    expect(gruppoDelPannello({ payment_method: 'cod', payout_status: 'REFUNDED', seller_payout_cents: 1800, pickup_in_store: true }).etichetta)
      .toBe('Rimborsato · recupero del rimborso');
    expect(gruppoDelPannello({ payment_method: 'cod', payout_status: 'CASH_IN_STORE', seller_payout_cents: 1800, seller_payout_reversed_cents: 450 }).etichetta)
      .toBe('Incassato al banco · recupero del rimborso');
    expect(gruppoDelPannello({ payment_method: 'cod', payout_status: 'REFUNDED', seller_payout_cents: 1800, pickup_in_store: false }).etichetta)
      .toBe('Rimborsato');
    expect(gruppoDelPannello({ payment_method: 'cod', payout_status: 'CASH_IN_STORE', seller_payout_cents: 1800 }).etichetta)
      .toBe('Incassato al banco');
  });
});
