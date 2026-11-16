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

// 16/11/2026 (R27-016 correzione) — Il finto rifiuta l'importo 0 (o non valido) come il vero
// (lib/stripe/payout.ts, «importo rimborso non valido»): stessa eccezione, la classe vera. Prima
// accettava 0, e la prova era verde con un annullo che col refundOrder vero cadeva.
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
const sendEmail = vi.fn(async (_e: { text: string }) => ({ ok: true }));
vi.mock('@/lib/email/client', () => ({ sendEmail: (e: { text: string }) => sendEmail(e) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { RimborsoNonRitentabile } from '@/lib/stripe/payout';
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
    expect(esito).toMatchObject({ ok: true, refundId: null });
    // Sulla carta del pane non c'è niente da rendere: nessun rimborso, l'ordine si chiude lo stesso.
    expect(resi()).toEqual([]);
    expect(riga('pane')).toMatchObject({ delivery_status: 'CANCELED' });
    expect(crediti).toEqual([{ p_cents: 1600, p_ref: 'pane' }]);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 13, wallet_applied_cents: 200, gross_total_cents: 1500 });
    expect(riga('pane')).toMatchObject({ delivery_fee_cents: 100, total_price: 0, wallet_applied_cents: 1600, gross_total_cents: 1600 });
    // Il cliente: 18 € di credito e 13 € di carta, gli tornano 16 € → paga 15 €, la frutta da sola.
    expect(1800 + 1300 - crediti[0].p_cents - 0).toBe(1500);
    // L'email dice il credito tornato davvero.
    expect(sendEmail.mock.calls.at(-1)?.[0].text).toMatch(/\(16,00\s€\) ti è stato restituito/u);
  });

  it("l'ordine cambia prima della chiusura: il credito torna com era su tutte e due le righe", async () => {
    conIlDatabase(colCredito('card', 1800));
    // Chi annulla aveva letto il pane in un altro stato: il turno non si prende, niente si chiude.
    const esito = await annullaERimborsa(db as never, { ...riga('pane'), delivery_status: 'ACCEPTED' } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito).toMatchObject({ ok: false, motivo: 'GIA_ANNULLATO' });
    expect(resi()).toEqual([]);
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
    expect(esito).toMatchObject({ ok: true, refundId: null });
    // Sulla carta del pane non c'è niente da rendere: nessun rimborso, l'ordine si chiude lo stesso.
    expect(resi()).toEqual([]);
    expect(riga('pane')).toMatchObject({ delivery_status: 'CANCELED' });
    expect(crediti).toEqual([{ p_cents: 1600, p_ref: 'pane' }]);
    // Sull'addebito restano 0,50 + 13 = 13,50 €: è il totale della frutta sulla carta, più 1,50 € di credito.
    expect(riga('frutta')).toMatchObject({ total_price: 13.5, wallet_applied_cents: 150, gross_total_cents: 1500, delivery_fee_cents: 300 });
    expect(riga('pane')).toMatchObject({ total_price: 0, wallet_applied_cents: 1600, gross_total_cents: 1600 });
    expect(1750 + 50 + 1300 - crediti[0].p_cents).toBe(1500);
  });
});

/**
 * 16/11/2026 (R27-018 correzione) — QUANTO SPOSTARE PARTE DALLA CARTA NON ANCORA RESA.
 *
 * Pane 15 € e frutta 12 € con la veloce, carrello spostato dal freno (1 € già reso sulla carta del
 * pane, la consegna scritta resta 4 €): il pane 19 € pagato in parte col credito. Il forno rifiuta:
 * il cliente deve pagare 15 € in tutto (la frutta da sola), quindi gli tornano 17 € fra l'euro del
 * freno, la carta e il credito. Col totale intero al posto del totale meno il già reso, l'euro del
 * freno contava due volte: tornavano 17 € di credito invece di 16, e MyCity perdeva 1 €.
 */
describe('R27-018 correzione — il credito spostato conta la carta già resa', () => {
  function spostatoDalFreno(cartaCents: number) {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', { veloce: true });
    expect(ordini.map((o) => [o.delivery_fee_cents, o.gross_total_cents])).toEqual([[400, 1900], [100, 1300]]);
    for (const o of ordini) o.delivery_slot = 'Oggi · 18:00–20:00';
    Object.assign(ordini[0], {
      refunded_amount_cents: 100, payment_status: 'PARTIALLY_REFUNDED', wallet_applied_cents: 1900 - cartaCents, total_price: cartaCents / 100,
    });
    return ordini;
  }

  it.each([
    [200, 0, 1600],
    [100, 0, 1600],
    [150, 0, 1600],
    [250, 0, 1600],
    [300, 0, 1600],
    [400, 100, 1500],
  ])('parte carta del pane %i centesimi: sulla carta tornano %i, di credito %i, e il cliente paga 15 € in tutto', async (cartaCents, cartaResa, creditoReso) => {
    conIlDatabase(spostatoDalFreno(cartaCents));
    const esito = await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(resi()).toEqual(cartaResa > 0 ? [['pane', cartaResa]] : []);
    expect(crediti).toEqual([{ p_cents: creditoReso, p_ref: 'pane' }]);
    expect(riga('pane')).toMatchObject({ delivery_status: 'CANCELED' });
    const frutta = riga('frutta');
    expect(frutta).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, gross_total_cents: 1500 });
    expect(Math.round(Number(frutta.total_price) * 100) + Number(frutta.wallet_applied_cents)).toBe(1500);
    // Sulla carta del pane non resta niente: il suo totale è il già reso.
    expect(Math.round(Number(riga('pane').total_price) * 100)).toBe(Number(riga('pane').refunded_amount_cents));
    // Sull'addebito resta la frutta sulla carta: pagato con la carta meno l'euro del freno e il rimborso.
    expect(cartaCents + 1300 - 100 - cartaResa).toBe(Math.round(Number(frutta.total_price) * 100));
    // Il cliente: 19 + 13 = 32 € pagati, tornano 1 € del freno, la carta e il credito → 15 €.
    expect(3200 - 100 - cartaResa - creditoReso).toBe(1500);
  });
});

/**
 * 16/11/2026 (R27-018 correzione) — NEL GIRO DEGLI SCADUTI IL CREDITO SPOSTATO NON SI PERDE.
 *
 * Pane 15 € (18 € tutto a credito), frutta 12 € (13 € con la carta), carne 11 € (12 € con la carta).
 * Nessun negozio conferma e il giro li annulla tutti e tre. Prima il pane, con 0 da rendere sulla
 * carta, finiva «da chiudere a mano» col credito mai reso; poi la frutta rendeva il credito letto a
 * inizio giro (0) e i 2 € passati dal pane restavano sulla frutta annullata.
 */
describe('R27-018 correzione — il carrello col credito scade tutto nello stesso giro', () => {
  const scaduto = (s: number) => `2026-10-20T08:00:0${s}Z`;

  it('tornano tutti i 18 € di credito, la carta rende 11 + 14 = 25 €, nessun ordine annullato tiene credito non reso', async () => {
    const ordini = carrello(['pane', 'frutta', 'carne'], [1500, 1200, 1100], 'card', { creati: [scaduto(0), scaduto(1), scaduto(2)] });
    expect(ordini.map((o) => o.gross_total_cents)).toEqual([1800, 1300, 1200]);
    Object.assign(ordini[0], { wallet_applied_cents: 1800, total_price: 0 });
    conIlDatabase(ordini);
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    const j = await (await (POST as unknown as () => Promise<Response>)()).json();
    expect(j).toMatchObject({ canceled: 3, daChiudereAMano: 0, failed: 0 });
    expect(resi()).toEqual([['frutta', 1100], ['carne', 1400]]);
    expect(crediti.reduce((t, c) => t + c.p_cents, 0)).toBe(1800);
    for (const id of ['pane', 'frutta', 'carne']) {
      const o = riga(id);
      expect(o.delivery_status).toBe('CANCELED');
      const reso = crediti.filter((c) => c.p_ref === id).reduce((t, c) => t + c.p_cents, 0);
      expect(reso).toBe(Number(o.wallet_applied_cents ?? 0));
    }
    expect(crediti).toEqual([{ p_cents: 1600, p_ref: 'pane' }, { p_cents: 200, p_ref: 'frutta' }]);
    // Il cliente: 18 € di credito e 25 € di carta, tutto tornato.
    expect(resi().reduce((t, r) => t + Number(r[1]), 0)).toBe(2500);
  });
});
