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

// 16/11/2026 (R27-016 correzione) — Il finto rifiuta l'importo 0 (o non valido) come il vero
// (lib/stripe/payout.ts, «importo rimborso non valido»): stessa eccezione, la classe vera.
const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  if (!Number.isFinite(a.amountCents) || a.amountCents <= 0) throw new RimborsoNonRitentabile('refundOrder: importo rimborso non valido');
  const r = riga(a.orderId);
  Object.assign(r, { delivery_status: 'CANCELED', refunded_amount_cents: Number(r.refunded_amount_cents ?? 0) + a.amountCents });
  return { refundId: `re_${a.orderId}` };
});
vi.mock('@/lib/stripe/payout', async (orig) => ({
  ...(await orig<object>()),
  refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a),
}));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { RimborsoNonRitentabile } from '@/lib/stripe/payout';
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

/**
 * 16/11/2026 (R27-016 correzione) — IL PANE PAGATO QUASI TUTTO COL CREDITO.
 *
 * Lo stesso carrello, ma il pane (19 €) pagato 17 € col credito MyCity e 2 € con la carta; il freno
 * ha già reso 1 € sulla carta. Il forno rifiuta: col conto rifatto sulla carta del pane non resta
 * niente da rendere, e il refundOrder vero rifiuta 0. Prima della correzione il rifiuto finiva in
 * RIMBORSO_FALLITO, col pane vivo; prima ancora di R27-016 riusciva (1 € sulla carta) ma la frutta
 * restava a 1 € di consegna. Adesso il rifiuto riesce e la frutta passa a 3 € e 3 €.
 */
describe('R27-016 correzione — il pane pagato quasi tutto col credito', () => {
  function colCredito(cartaCents: number) {
    const ordini = spostatoDalFreno();
    ordini[0].wallet_applied_cents = 1900 - cartaCents;
    ordini[0].total_price = cartaCents / 100;
    return ordini;
  }

  it('17 € di credito e 2 € di carta, 1 € già reso: il rifiuto riesce, niente rimborso da 0, la frutta passa a 3 € e 3 €', async () => {
    const ordini = colCredito(200);
    db = finto({ orders: ordini });
    db.rpc = (async () => ({ data: null, error: null })) as typeof db.rpc;
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito).toMatchObject({ ok: true, refundId: null });
    expect(refundOrder).not.toHaveBeenCalled();
    expect(riga('pane')).toMatchObject({ delivery_status: 'CANCELED', refunded_amount_cents: 100 });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, gross_total_cents: 1500, delivery_status: 'NEW' });
  });

  it.each([100, 150, 250, 300])('parte carta del pane %i centesimi, 1 € già reso: il rifiuto riesce e la carta non rende niente', async (cartaCents) => {
    const ordini = colCredito(cartaCents);
    db = finto({ orders: ordini });
    db.rpc = (async () => ({ data: null, error: null })) as typeof db.rpc;
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(refundOrder).not.toHaveBeenCalled();
    expect(riga('pane')).toMatchObject({ delivery_status: 'CANCELED', refunded_amount_cents: 100 });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, gross_total_cents: 1500 });
  });

  it('con 4 € di carta resta 1 € da rendere: torna sulla carta, una volta sola', async () => {
    const ordini = colCredito(400);
    db = finto({ orders: ordini });
    db.rpc = (async () => ({ data: null, error: null })) as typeof db.rpc;
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents])).toEqual([['pane', 100]]);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, gross_total_cents: 1500 });
  });

  it('il finto rifiuta 0 come il vero: stessa eccezione, non ritentabile', async () => {
    await expect(refundOrder({ orderId: 'pane', amountCents: 0 })).rejects.toMatchObject({
      name: 'RimborsoNonRitentabile', ritentabile: false, message: 'refundOrder: importo rimborso non valido',
    });
  });
});
