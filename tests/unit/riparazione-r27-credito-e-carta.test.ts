import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 15/11/2026 (R27-018, R27-019) — COL CREDITO MYCITY E LA CARTA, LA DIFFERENZA DELLA CONSEGNA SI
 * PAGA COL CREDITO.
 *
 * Pane 15 € e frutta 12 €, carrello con la carta: il pane porta la base (18 €), la frutta il suo
 * euro di fermata (13 €). Il forno rifiuta: la frutta da sola paga 3 € di consegna, quindi il
 * cliente deve pagare 15 € in tutto, e del pane gli tornano 16 € (la merce più la differenza).
 *
 * R27-018 — il pane pagato tutto col credito (18 €), la frutta con la carta (13 €). Prima il totale
 * del pane si fermava a zero e il credito tornava tutto: 18 € di credito resi, la frutta scritta
 * 15 € su 13 addebitati, e il cliente pagava netto 13 € invece di 15 (2 € in più al cliente).
 *
 * R27-019 — il pane pagato 17,50 € col credito e 0,50 € con la carta. Prima: totale del pane a 0,
 * carta 0, credito 17,50 € resi; la frutta scritta 15 €, ma sull'addebito restano 13,50 €.
 *
 * Adesso il credito che serve a pagare la differenza non torna: passa alla frutta, che resta sulla
 * carta per quello che la carta ha pagato davvero. Coi contanti invece la differenza la paga chi
 * apre la porta (15 € alla frutta) e il credito torna tutto, come prima.
 */

const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  Object.assign(riga(a.orderId), { delivery_status: 'CANCELED' });
  return { refundId: `re_${a.orderId}` };
});
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
const sendEmail = vi.fn(async (_e: { text: string }) => ({ ok: true }));
vi.mock('@/lib/email/client', () => ({ sendEmail: (e: { text: string }) => sendEmail(e) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { carrello, finto, tentativoDiCassa } from './carrello-finto';

const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
const resi = () => refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents]);
let crediti: Array<{ p_cents: number; p_ref: string }> = [];

function conIlDatabase(ordini: ReturnType<typeof carrello>, altro: Record<string, Array<Record<string, unknown>>> = {}) {
  db = finto({ orders: ordini, ...altro });
  crediti = [];
  db.rpc = (async (nome: string, args: { p_cents: number; p_ref: string }) => {
    if (nome === 'wallet_credit') crediti.push({ p_cents: args.p_cents, p_ref: args.p_ref });
    return { data: null, error: null };
  }) as typeof db.rpc;
}

/** Il pane pagato `creditoCents` col credito MyCity, il resto con la carta; la frutta tutta con la carta. */
function colCredito(pagamento: 'card' | 'cod', creditoCents: number) {
  const ordini = carrello(['pane', 'frutta'], [1500, 1200], pagamento);
  expect(ordini.map((o) => [o.gross_total_cents, o.delivery_fee_cents, o.rider_fee_cents])).toEqual([[1800, 300, 300], [1300, 100, 100]]);
  ordini[0].wallet_applied_cents = creditoCents;
  ordini[0].total_price = (1800 - creditoCents) / 100;
  return ordini;
}

beforeEach(() => {
  refundOrder.mockClear();
  sendEmail.mockClear();
});

describe('R27-018 — pane tutto a credito, frutta con la carta', () => {
  it('il forno rifiuta: tornano 16 € di credito e non 18, la frutta resta 13 € sulla carta più 2 € di credito', async () => {
    conIlDatabase(colCredito('card', 1800));
    const esito = await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(resi()).toEqual([['pane', 0]]);
    expect(crediti).toEqual([{ p_cents: 1600, p_ref: 'pane' }]);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 13, wallet_applied_cents: 200, gross_total_cents: 1500 });
    expect(riga('pane')).toMatchObject({ delivery_fee_cents: 100, total_price: 0, wallet_applied_cents: 1600, gross_total_cents: 1600 });
    // Il cliente: 18 € di credito e 13 € di carta, gli tornano 16 € → paga 15 €, la frutta da sola.
    expect(1800 + 1300 - crediti[0].p_cents - 0).toBe(1500);
    // L'email dice il credito tornato davvero.
    expect(sendEmail.mock.calls.at(-1)?.[0].text).toMatch(/\(16,00\s€\) ti è stato restituito/u);
  });

  it('il rimborso cade: il credito torna com era su tutte e due le righe', async () => {
    conIlDatabase(colCredito('card', 1800));
    refundOrder.mockImplementationOnce(async () => {
      throw new Error('Stripe timeout');
    });
    const esito = await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(false);
    expect(crediti).toEqual([]);
    expect(riga('pane')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 0, wallet_applied_cents: 1800, gross_total_cents: 1800 });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13, wallet_applied_cents: 0, gross_total_cents: 1300 });
  });

  it('coi contanti non cambia niente: alla porta la frutta paga 15 € e il credito torna tutto (18 €)', async () => {
    const ordini = colCredito('cod', 1800);
    conIlDatabase(ordini, { cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']) });
    const esito = await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(crediti).toEqual([{ p_cents: 1800, p_ref: 'pane' }]);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, total_price: 15, wallet_applied_cents: 0 });
  });
});

describe('R27-019 — il credito copre quasi tutto l ordine annullato', () => {
  it('pane 17,50 € di credito e 0,50 € di carta: tornano 16 € di credito, la frutta resta 13,50 € sulla carta come l addebito', async () => {
    conIlDatabase(colCredito('card', 1750));
    const esito = await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(resi()).toEqual([['pane', 0]]);
    expect(crediti).toEqual([{ p_cents: 1600, p_ref: 'pane' }]);
    // Sull'addebito restano 0,50 + 13 = 13,50 €: è il totale della frutta sulla carta, più 1,50 € di credito.
    expect(riga('frutta')).toMatchObject({ total_price: 13.5, wallet_applied_cents: 150, gross_total_cents: 1500, delivery_fee_cents: 300 });
    expect(riga('pane')).toMatchObject({ total_price: 0, wallet_applied_cents: 1600, gross_total_cents: 1600 });
    expect(1750 + 50 + 1300 - crediti[0].p_cents).toBe(1500);
  });
});
