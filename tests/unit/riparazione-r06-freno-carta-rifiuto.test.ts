import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/11/2026 (R06-016) — CARRELLO CARTA SPOSTATO DAL FRENO: SE POI UN NEGOZIO RIFIUTA, LA CONSEGNA
 * DEI RIMASTI SI RICALCOLA ANCORA.
 *
 * Con la carta il freno della veloce scrive solo la fascia: l'euro della veloce torna sulla carta con
 * un rimborso, ma resta scritto in `delivery_fee_cents`. Il ricalcolo dopo un rifiuto prendeva «non
 * veloce» dalla fascia nuova, non riconosceva il conto scritto e non rifaceva niente: la frutta,
 * rimasta sola, teneva 1 € di consegna e 1 € al fattorino invece di 3 e 3, e i 2 € li pagava MyCity.
 *
 * Se diventa rosso: il carrello spostato dal freno non si riconosce più, oppure l'euro della veloce,
 * già reso sulla carta, si sposta su un altro ordine o si rende due volte.
 *
 * Il carrello e il database finto sono quelli comuni (tests/unit/carrello-finto.ts): cifre di
 * `prezziDelCarrello`, filtri e scritture applicati davvero.
 */

const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => ({ refundId: 're_1', importoCents: a.amountCents }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { finto, carrello, ingressi } from './carrello-finto';

const MERCI = [1500, 1200];
const FASCIA = 'Oggi · 18:00–20:00';
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
const letto = (id: string) => ({ ...riga(id) }) as never;
const cent = (euro: unknown) => Math.round(Number(euro) * 100);

/** L'euro della veloce di ogni ordine: consegna della veloce meno consegna della fascia, per la stessa spesa. */
const veloce = prezziDelCarrello(ingressi(MERCI, true)).gruppi;
const inFascia = prezziDelCarrello(ingressi(MERCI, false)).gruppi;
const euroDi = (i: number) => veloce[i].deliveryFeeCents - inFascia[i].deliveryFeeCents;

/** Il carrello come lo lascia il freno con la carta: fascia nuova, euro reso sulla carta, consegna scritta invariata. */
function dopoIlFreno() {
  const ordini = carrello(['pane', 'frutta'], MERCI, 'card', { veloce: true }).map((o, i) => ({
    ...o,
    delivery_slot: FASCIA,
    refunded_amount_cents: euroDi(i),
    payment_status: euroDi(i) > 0 ? 'PARTIALLY_REFUNDED' : 'PAID',
  }));
  db = finto({ orders: ordini });
  return ordini.map((o) => ({ ...o }));
}

beforeEach(() => {
  refundOrder.mockClear();
});

describe('carrello carta spostato dal freno della veloce, poi un negozio rifiuta', () => {
  it('l euro della veloce c era davvero (la prova non vale su un carrello senza)', () => {
    expect(euroDi(0) + euroDi(1)).toBeGreaterThan(0);
  });

  it('il forno rifiuta: la frutta rimasta sola ha consegna e fattorino della regola, e il cliente paga solo la frutta', async () => {
    const prima = dopoIlFreno();
    const sola = prezziDelCarrello(ingressi([MERCI[1]], false)).gruppi[0];

    const esito = await annullaERimborsa(db as never, letto('pane'), { reason: 'Rifiutato dal negozio' });

    expect(esito).toMatchObject({ ok: true });
    expect(riga('frutta'), 'la consegna dei rimasti non si è ricalcolata').toMatchObject({
      delivery_fee_cents: sola.deliveryFeeCents + euroDi(1),
      rider_fee_cents: sola.riderFeeCents,
    });
    expect(cent(riga('frutta').total_price)).toBe(sola.totalCents + euroDi(1));
    // Pagati sulla carta: i due totali. Tornati: gli euro del freno e il rimborso del forno. Resta la frutta.
    const pagato = prima.reduce((s, o) => s + cent(o.total_price), 0);
    const resoDalForno = refundOrder.mock.calls[0][0].amountCents;
    expect(pagato - euroDi(0) - euroDi(1) - resoDalForno).toBe(sola.totalCents);
  });

  it('la frutta rifiuta: il forno resta com era, l euro già reso non si sposta e non si rende due volte', async () => {
    const prima = dopoIlFreno();

    await annullaERimborsa(db as never, letto('frutta'), { reason: 'Rifiutato dal negozio' });

    const forno = prima[0];
    expect(riga('pane')).toMatchObject({
      delivery_fee_cents: forno.delivery_fee_cents,
      rider_fee_cents: forno.rider_fee_cents,
      total_price: forno.total_price,
    });
    expect(refundOrder.mock.calls[0][0]).toMatchObject({ orderId: 'frutta', amountCents: cent(prima[1].total_price) - euroDi(1) });
  });
});
