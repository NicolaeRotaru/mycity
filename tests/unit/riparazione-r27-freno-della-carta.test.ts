import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 15/11/2026 (R27-016) — IL CARRELLO CON LA CARTA SPOSTATO DAL FRENO DELLA VELOCE SI RICALCOLA.
 *
 * Pane 15 € e frutta 12 € con la veloce, pagati con la carta: consegna 4 € sul pane (3 di base più
 * l'euro della veloce) e 1 € sulla frutta, 19 + 13 = 32 € addebitati. Il negozio non conferma in
 * 10 minuti: il freno rende l'euro sulla carta (1 € sul pane) e sposta il carrello in fascia, ma
 * con la carta la consegna scritta resta 4 € (lib/ordini/veloce-non-confermata.ts, «Con la CARTA
 * il conto scritto sull'ordine non si tocca»). Poi il forno rifiuta.
 *
 * La regola (consegna.negozio-che-rifiuta): la frutta da sola paga 3 € di consegna e il fattorino
 * prende 3 €; al cliente tornano la merce del forno e la differenza della consegna, 16 € (19 − 2,
 * meno l'euro già reso). Prima il conto non si riconosceva più: la frutta restava a 1 € di
 * consegna e 1 € al fattorino, e dal forno tornavano 18 € — il cliente pagava 2 € in meno della
 * regola e la differenza la pagava MyCity in silenzio.
 */

const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  Object.assign(riga(a.orderId), { delivery_status: 'CANCELED' });
  return { refundId: `re_${a.orderId}` };
});
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { carrello, finto } from './carrello-finto';

const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;

/** Il carrello dopo il freno con la carta: fascia nuova, consegna scritta con l'euro, l'euro reso sul pane. */
function spostatoDalFreno() {
  const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { veloce: true });
  expect(ordini.map((o) => [o.delivery_fee_cents, o.rider_fee_cents, o.total_price])).toEqual([[400, 300, 19], [100, 100, 13]]);
  for (const o of ordini) o.delivery_slot = 'Oggi · 18:00–20:00';
  ordini[0].refunded_amount_cents = 100;
  ordini[0].payment_status = 'PARTIALLY_REFUNDED';
  return ordini;
}

beforeEach(() => {
  refundOrder.mockClear();
});

describe('R27-016 — carrello con la carta spostato dal freno della veloce', () => {
  it('il forno rifiuta: la frutta passa a 3 € di consegna e 3 € al fattorino, dal forno tornano 16 € e non 18', async () => {
    const ordini = spostatoDalFreno();
    db = finto({ orders: ordini });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents])).toEqual([['pane', 1600]]);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15, gross_total_cents: 1500 });
    // I conti del cliente: 32 € addebitati, 1 € reso dal freno, 16 € dal rifiuto → paga 15 €, la frutta da sola.
    expect(3200 - 100 - 1600).toBe(Math.round(Number(riga('frutta').total_price) * 100));
  });

  it('la frutta rifiuta: il pane resta col suo conto (4 € scritti, 1 € già reso) e della frutta tornano 13 €', async () => {
    const ordini = spostatoDalFreno();
    db = finto({ orders: ordini });
    const esito = await annullaERimborsa(db as never, { ...ordini[1] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents])).toEqual([['frutta', 1300]]);
    expect(riga('pane')).toMatchObject({ delivery_fee_cents: 400, rider_fee_cents: 300, total_price: 19, refunded_amount_cents: 100 });
  });

  it("se l'euro non è ancora tornato sulla carta (lo rende una persona) il conto non si tocca, come prima", async () => {
    const ordini = spostatoDalFreno();
    ordini[0].refunded_amount_cents = 0;
    ordini[0].payment_status = 'PAID';
    db = finto({ orders: ordini });
    await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents])).toEqual([['pane', 1900]]);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
  });
});
