import { describe, it, expect } from 'vitest';
import { promemoriaOTotale } from '@/lib/stripe/webhook/dispute';
import * as conti from '@/lib/stripe/webhook/quanto-restituire';

/**
 * R11-021 — Dopo un rimborso parziale, una contestazione vinta senza promemoria
 * ripagava al negozio anche la parte del rimborso. Ordine da 40 €, netto 32,40 €,
 * reso da 6,17 € (500 sul netto) già stornato, poi contestazione piena: senza il
 * promemoria della 126 si restituivano 32,40 € invece di 27,40.
 */

type Fn = (p: number | null, t: number | null, s: unknown, q?: number) => number | null;
const stornato = conti.stornatoDaQuestaContestazione as unknown as Fn;
const quota = (o: Record<string, number>) =>
  (conti as unknown as Record<string, ((o: Record<string, number>) => number | undefined) | undefined>)['quotaDelRimborsoSulNetto']?.(o);

describe('R11-021 — contestazione vinta dopo un rimborso parziale, senza promemoria', () => {
  it('si restituisce lo stornato meno la quota del rimborso', () => {
    const q = quota({ refunded_amount_cents: 617, gross_total_cents: 4000, seller_payout_cents: 3240 });
    expect(stornato(0, 3240, 'PARTIALLY_REFUNDED', q), 'il negozio si fa ripagare anche il reso già del cliente').toBe(2740);
  });

  it('col promemoria vale il promemoria; senza rimborso il totale, come prima', () => {
    expect(stornato(2740, 3240, 'PARTIALLY_REFUNDED', 500)).toBe(2740);
    expect(stornato(0, 3240, 'PAID', undefined)).toBe(3240);
    expect(stornato(0, 3240, 'REFUNDED', undefined)).toBeNull();
    expect(promemoriaOTotale(0, 3240)).toBe(3240);
  });
});
