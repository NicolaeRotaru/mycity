import { describe, it, expect } from 'vitest';
import { riepilogoContanti, riepilogoNegozio, type OrdineNegozio } from '@/lib/guadagni/negozio';

/**
 * R11-005 — Ritiro in negozio pagato in contanti al banco: la pagina Guadagni
 * diceva al negozio che gli sarebbero arrivati i 18 € che ha già in cassa, e
 * che li aveva raccolti un fattorino. Il ritiro al banco (CASH_IN_STORE) non fa
 * partire nessun bonifico: la commissione la deve il negozio.
 */

const ordine = (extra: Partial<OrdineNegozio>): OrdineNegozio => ({
  total_price: 20,
  payment_method: 'cod',
  payout_status: 'AWAITING_REMITTANCE',
  seller_payout_cents: 1800,
  seller_payout_reversed_cents: 0,
  refunded_amount_cents: 0,
  application_fee_cents: 200,
  ...extra,
});
const sempre = () => true;

describe('R11-005 — il ritiro pagato al banco', () => {
  it('non è netto «che arriva a te» né contante del fattorino', () => {
    const r = riepilogoContanti([ordine({ payout_status: 'CASH_IN_STORE', pickup_in_store: true })], sempre);
    expect(r.nettoAlNegozioCents, 'il negozio aspetta 18 € che ha già in cassa').toBe(0);
    expect(r.incassatoDalFattorinoCents, 'nessun fattorino ha raccolto quei soldi').toBe(0);
  });

  it('compare a parte: incassati al banco, con la commissione dovuta', () => {
    const r = riepilogoContanti([ordine({ payout_status: 'CASH_IN_STORE', pickup_in_store: true })], sempre);
    expect(r.incassatoAlBancoCents).toBe(2000);
    expect(r.commissioneDovutaCents).toBe(200);
  });

  it('il contrassegno col fattorino resta com era', () => {
    const r = riepilogoContanti([ordine({}), ordine({ payout_status: 'CASH_IN_STORE', pickup_in_store: true })], sempre);
    expect(r.nettoAlNegozioCents).toBe(1800);
    expect(r.incassatoDalFattorinoCents).toBe(2000);
  });

  it('anche senza il segno pickup_in_store, lo stato CASH_IN_STORE basta', () => {
    const r = riepilogoContanti([ordine({ payout_status: 'CASH_IN_STORE' })], sempre);
    expect(r.nettoAlNegozioCents).toBe(0);
  });

  it('i bonifici non lo contano né fra i versati né fra quelli in arrivo', () => {
    const r = riepilogoNegozio([ordine({ payout_status: 'CASH_IN_STORE', pickup_in_store: true })]);
    expect(r.versatiCents + r.inArrivoCents).toBe(0);
  });
});
