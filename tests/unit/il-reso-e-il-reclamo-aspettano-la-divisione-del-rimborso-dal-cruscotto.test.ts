import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 (terzo riesame del lotto) — UN RECLAMO O UN RESO SU UN CARRELLO
 * FERMO RENDEVA DI NUOVO QUELLO CHE IL CRUSCOTTO AVEVA GIÀ RESO.
 *
 * Il caso: carrello da Pane Quotidiano (15,00 €, bonifico da fare, netto
 * 10,00) e da un fioraio (12,90 €, bonifico già partito, netto 9,00), un solo
 * pagamento con la carta. Manca una focaccia e Nicola rende 3 € dal cruscotto
 * Stripe: il webhook ferma i bonifici del carrello e non scrive niente sugli
 * ordini. Prima della divisione si chiude un reclamo sul pane con 15,00 €.
 * `refundOrder` guardava solo il rimborsato scritto sull'ordine — zero — e
 * Stripe li dava (sul pagamento ne restavano 24,90): al cliente del pane
 * tornavano 18 € su un ordine da 15. Poi i 3 € da dividere si potevano mettere
 * solo sul fioraio, che perdeva 2,09 € con uno storno.
 *
 * La regola «prima si divide» stava nell'annullo e nel giro degli ordini
 * scaduti. Adesso sta in `refundOrder`, dove passano anche i resi e i reclami.
 *
 * La prova fa girare il webhook VERO, la rotta VERA del reclamo, quella VERA
 * del reso, il giro VERO degli ordini scaduti e la divisione VERA dal pannello,
 * contro un database finto e uno Stripe finto che, come quello vero, rende
 * finché sul pagamento c'è qualcosa.
 */

type RimborsoSuStripe = { id: string; amount: number; status: string; metadata: Record<string, string>; created: number; chiave: string | null };
const stato: {
  db: FintoDatabase;
  carica: { amount: number; refunded: number };
  suStripe: RimborsoSuStripe[];
  storni: Array<{ transferId: string; amount: number }>;
  utente: string;
} = { db: fintoDatabase(), carica: { amount: 2790, refunded: 0 }, suStripe: [], storni: [], utente: 'admin1' };
let orologio = 1_800_000_000;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => stato.db.client,
  getServerSupabase: async () => stato.db.client,
}));
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
  withAdminAuth: (h: (ctx: unknown) => unknown) => async (req: unknown, ctx?: { params: Promise<Record<string, string>> }) =>
    h({ req, user: { id: 'admin1' }, profile: { role: 'admin' }, params: (await ctx?.params) ?? {} }),
  withAuthRateLimit:
    (_o: unknown, h: (ctx: unknown) => unknown) =>
    async (req: unknown, ctx?: { params: Promise<Record<string, string>> }) =>
      h({ req, user: { id: stato.utente }, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: async (p: { amount: number; metadata?: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = stato.suStripe.find((r) => r.chiave === o.idempotencyKey);
        if (gia) return { id: gia.id, status: gia.status };
        const resta = stato.carica.amount - stato.carica.refunded;
        if (p.amount > resta) throw new Error(`Refund amount (${p.amount}) is greater than unrefunded amount on charge (${resta})`);
        stato.carica.refunded += p.amount;
        const nuovo = { id: `re_${stato.suStripe.length + 1}`, amount: p.amount, status: 'succeeded', metadata: p.metadata ?? {}, created: ++orologio, chiave: o.idempotencyKey };
        stato.suStripe.push(nuovo);
        return { id: nuovo.id, status: nuovo.status };
      },
      list: async () => ({ data: [...stato.suStripe].reverse().map((r) => ({ ...r, metadata: { ...r.metadata } })), has_more: false }),
      update: async (id: string, p: { metadata?: Record<string, string> }) => {
        const r = stato.suStripe.find((x) => x.id === id);
        if (!r) throw new Error(`No such refund: ${id}`);
        r.metadata = { ...r.metadata, ...(p.metadata ?? {}) };
        return { ...r };
      },
    },
    transfers: {
      createReversal: async (transferId: string, p: { amount: number }, o: { idempotencyKey: string }) => {
        stato.storni.push({ transferId, amount: p.amount });
        return { id: `trr_${o.idempotencyKey}` };
      },
      list: async () => ({ data: [] }),
    },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';
import { RimborsoInAttesaDellaDivisione, refundOrder } from '@/lib/stripe/payout';
import { POST as dividiDalPannello } from '@/app/api/admin/orders/rimborsi-da-dividere/route';
import { POST as chiudiIlReclamo } from '@/app/api/admin/disputes/[id]/resolve/route';
import { POST as decidiIlReso } from '@/app/api/returns/[id]/decide/route';

const QUATTRO_ORE_FA = () => new Date(Date.now() - 4 * 3_600_000).toISOString();

function ordine(extra: Riga): Riga {
  return {
    user_id: 'cliente1', payment_method: 'card', payment_status: 'PAID', delivery_status: 'DELIVERED',
    refunded_amount_cents: 0, payout_status: 'HELD', payout_tentativo: 0, seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1', stripe_charge_id: 'ch_1', stripe_session_id: 'cs_1', stripe_transfer_id: null,
    stripe_reversal_id: null, stripe_refund_id: null, internal_dispute_status: null, dispute_status: null,
    coupon_code: null, wallet_applied_cents: 0, cash_confirmed_at: null, created_at: QUATTRO_ORE_FA(), delivery_slot: null,
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: null, shipping_cost: 0,
    ...extra,
  };
}

const riga = (id: string) => stato.db.tabelle.orders!.find((r) => r.id === id)!;
/** Quanto è uscito da Stripe con l'etichetta di quell'ordine (i rimborsi del sito). */
const uscitoDalSitoPer = (id: string) => stato.suStripe.filter((r) => r.metadata.order_id === id).reduce((s, r) => s + r.amount, 0);

async function rimborsoDalCruscotto(centesimi: number): Promise<void> {
  stato.carica.refunded += centesimi;
  stato.suStripe.push({ id: `re_cruscotto_${stato.suStripe.length + 1}`, amount: centesimi, status: 'succeeded', metadata: {}, created: ++orologio, chiave: null });
  await handleChargeRefunded({
    id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: stato.carica.amount, amount_refunded: stato.carica.refunded,
  } as unknown as Parameters<typeof handleChargeRefunded>[0]);
}

async function dividi(parti: Array<{ ordine: string; centesimi: number }>): Promise<number> {
  const res = await (dividiDalPannello as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pagamento: 'pi_1', parti }) }),
  );
  return res.status;
}

async function chiudi(corpo: Record<string, unknown>): Promise<{ status: number; corpo: string }> {
  const res = await (chiudiIlReclamo as unknown as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ id: 'd1' }) },
  );
  return { status: res.status, corpo: await res.text() };
}

async function ilNegozioDecide(corpo: Record<string, unknown>): Promise<{ status: number; corpo: string }> {
  stato.utente = 'pane-quotidiano';
  const res = await (decidiIlReso as unknown as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request('http://x/api/returns/r1/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ id: 'r1' }) },
  );
  return { status: res.status, corpo: await res.text() };
}

async function giroDegliOrdiniScaduti(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return res.json();
}

beforeEach(() => {
  stato.carica = { amount: 2790, refunded: 0 };
  stato.suStripe = [];
  stato.storni = [];
  stato.utente = 'admin1';
  stato.db = fintoDatabase({
    orders: [
      ordine({ id: 'pane01', seller_id: 'pane-quotidiano', total_price: 15, gross_total_cents: 1500, seller_payout_cents: 1000 }),
      ordine({
        id: 'fiori1', seller_id: 'fioraio', total_price: 12.9, gross_total_cents: 1290, seller_payout_cents: 900,
        payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_fiori',
      }),
    ],
    disputes: [{ id: 'd1', status: 'open', order_id: 'pane01', opener_id: 'cliente1', against_id: 'pane-quotidiano' }],
    returns: [{ id: 'r1', status: 'REQUESTED', seller_id: 'pane-quotidiano', buyer_id: 'cliente1', order_id: 'pane01', reason: 'DAMAGED', refund_amount_cents: null }],
    profiles: [
      { id: 'admin1', role: 'admin' },
      { id: 'pane-quotidiano', role: 'seller', store_name: 'Pane Quotidiano' },
      { id: 'fioraio', role: 'seller', store_name: 'Il fioraio' },
    ],
    notifications: [],
    audit_logs: [],
    activity_events: [],
  });
  stato.db.rispostaRpc = (nome, a) => {
    const r = stato.db.tabelle.orders!.find((x) => x.id === a.p_order_id);
    if (nome === 'accumula_rimborso' && r) {
      const tot = Number(r.gross_total_cents);
      const nuovo = Number(r.refunded_amount_cents ?? 0) + Number(a.p_delta);
      if (nuovo > tot) return { data: [], error: null };
      r.refunded_amount_cents = nuovo;
      return { data: [{ totale_rimborsato: nuovo, totale_ordine: tot }], error: null };
    }
    if (nome === 'storna_rimborso' && r) r.refunded_amount_cents = Number(r.refunded_amount_cents ?? 0) - Number(a.p_delta);
    return { data: null, error: null };
  };
});

describe('un reclamo o un reso su un carrello fermo aspettano la divisione del rimborso dal cruscotto', () => {
  it('IL CASO DEL RIESAME — reclamo sul pane chiuso con 15 € prima della divisione: non esce niente; dopo, al pane tornano 15 € in tutto', async () => {
    await rimborsoDalCruscotto(300);
    expect(riga('pane01').internal_dispute_status, 'il webhook non ha fermato il carrello').toBe('RIMBORSO_DA_RIPARTIRE');

    const primo = await chiudi({ status: 'resolved_buyer', refundCents: 1500, notes: 'focaccia mancante' });
    expect(primo.status, primo.corpo).toBeGreaterThanOrEqual(400);
    expect(primo.corpo, 'chi chiude il reclamo non sa perché il rimborso non parte').toContain('da dividere');
    expect(uscitoDalSitoPer('pane01'), 'il cliente del pane riceve 15 € oltre ai 3 € del cruscotto').toBe(0);
    expect(stato.carica.refunded).toBe(300);
    expect(riga('pane01').refunded_amount_cents, 'la prenotazione del rimborso è rimasta sull ordine').toBe(0);
    expect(stato.db.tabelle.disputes![0].status, 'il reclamo resta chiuso senza rimborso').toBe('open');

    // Nicola divide: i 3 € erano della focaccia del pane.
    expect(await dividi([{ ordine: 'pane01', centesimi: 300 }, { ordine: 'fiori1', centesimi: 0 }])).toBe(200);
    expect(stato.storni, 'il fioraio paga una focaccia che non ha venduto').toEqual([]);

    const secondo = await chiudi({ status: 'resolved_buyer', refundCents: 1200, notes: 'focaccia mancante' });
    expect(secondo.status, secondo.corpo).toBe(200);
    expect(uscitoDalSitoPer('pane01') + 300, 'al cliente del pane tornano più soldi del suo ordine').toBe(1500);
    expect(riga('pane01')).toMatchObject({ refunded_amount_cents: 1500, payment_status: 'REFUNDED' });
    expect(riga('fiori1')).toMatchObject({ refunded_amount_cents: 0, seller_payout_reversed_cents: 0 });
  });

  it('LA VARIANTE SCOMODA — il pane ha un reclamo aperto e il webhook non lo ferma: la pausa sta solo sui fiori, e il rimborso del pane aspetta lo stesso', async () => {
    riga('pane01').internal_dispute_status = 'OPEN';
    await rimborsoDalCruscotto(300);
    expect(riga('pane01').internal_dispute_status).toBe('OPEN');
    expect(riga('fiori1').internal_dispute_status).toBe('RIMBORSO_DA_RIPARTIRE');

    await expect(refundOrder({ orderId: 'pane01', amountCents: 1500, idempotencyKey: 'dispute_d1' })).rejects.toBeInstanceOf(
      RimborsoInAttesaDellaDivisione,
    );
    expect(stato.carica.refunded).toBe(300);
    expect(riga('pane01').refunded_amount_cents).toBe(0);
    expect(stato.db.rpc.filter((c) => c.nome === 'accumula_rimborso'), 'si è prenotato un rimborso che non può partire').toEqual([]);
  });

  it('il negozio che decide un reso sulla carta legge perché il rimborso aspetta, e il reso resta da decidere', async () => {
    await rimborsoDalCruscotto(300);

    const esito = await ilNegozioDecide({ decision: 'APPROVED', refundAmountCents: 500 });

    expect(esito.status, esito.corpo).toBe(409);
    expect(esito.corpo, 'il negozio legge solo «riprova», e riprovando non cambia niente').toContain('da dividere');
    expect(stato.carica.refunded).toBe(300);
    expect(stato.db.tabelle.returns![0].status).toBe('REQUESTED');
  });

  it('il messaggio arriva intero a chi ha premuto: corto, una riga sola, senza parentesi', () => {
    const { message } = new RimborsoInAttesaDellaDivisione('pane01');
    // `friendlyError` (lib/errors.ts) lo lascia passare solo così; davanti la rotta del reclamo mette «Rimborso fallito: ».
    expect(`Rimborso fallito: ${message}`.length).toBeLessThan(200);
    expect(message).not.toMatch(/[\n()]/);
  });

  it('se la pausa arriva mentre il giro annulla un ordine scaduto, l ordine torna in coda invece di restare annullato e non rimborsato', async () => {
    riga('pane01').delivery_status = 'NEW';
    // Il rimborso dal cruscotto e il suo avviso arrivano proprio mentre il giro prende l'ordine.
    stato.db.guasto = (s) => {
      const valori = s.valori as Riga | null;
      if (s.tabella === 'orders' && s.operazione === 'update' && valori?.delivery_status === 'CANCELED') {
        riga('fiori1').internal_dispute_status = 'RIMBORSO_DA_RIPARTIRE';
      }
      return null;
    };

    const giro = await giroDegliOrdiniScaduti();

    expect(stato.carica.refunded, 'il giro ha reso il lordo intero con la pausa già messa').toBe(0);
    expect(riga('pane01').delivery_status, 'l ordine resta annullato e nessuno lo rimborsa più').toBe('NEW');
    expect(giro).toMatchObject({ refunded: 0 });
    expect(
      stato.db.tabelle.notifications!.filter((n) => String(n.title).includes('chiudere a mano')),
      'un ordine che si potrà rimborsare dopo la divisione finisce fra quelli da chiudere a mano',
    ).toEqual([]);
  });
});
