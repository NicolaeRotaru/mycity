import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 (riesame del lotto) — CHIUDERE UN RECLAMO TOGLIEVA LA PAUSA AL
 * CARRELLO, E IL RIMBORSO DAL CRUSCOTTO FINIVA ADDOSSO ALL'ALTRO NEGOZIO.
 *
 * La pausa dei bonifici per un rimborso da dividere e l'esito di un reclamo
 * interno stanno nella stessa colonna (`internal_dispute_status`). Il caso:
 * carrello da Pane Quotidiano (15,00 €) e da un fioraio (12,90 €). Il cliente
 * si lamenta del pane e Nicola gli rende 3 € dal cruscotto Stripe: il webhook
 * ferma i due bonifici. Poi Nicola chiude il reclamo dal pannello senza
 * importo, perché i soldi sono già usciti. La chiusura scriveva 'RESOLVED' sul
 * pane senza guardare: ① il pane tornava pagabile col netto intero; ② il
 * pannello offriva i 3 € da dividere solo al fioraio, che restava senza
 * bonifico o pagava 2,09 € di un rimborso non suo.
 *
 * E un secondo modo di arrivarci: un ordine che il webhook non ferma (un
 * reclamo ancora aperto) restava fuori dalla divisione, anche se i soldi erano
 * suoi.
 *
 * La prova fa girare il webhook VERO, la rotta VERA che chiude il reclamo e la
 * rotta VERA della divisione, contro un database finto.
 */

type RimborsoSuStripe = { id: string; amount: number; status: string; metadata: Record<string, string>; created: number };
const stato: { db: FintoDatabase; refunded: number; suStripe: RimborsoSuStripe[] } = { db: fintoDatabase(), refunded: 0, suStripe: [] };
let orologio = 1_800_000_000;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (ctx: unknown) => unknown) => async (req: unknown, ctx?: { params: Promise<Record<string, string>> }) =>
    h({ req, user: { id: 'admin1' }, profile: { role: 'admin' }, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      list: async () => ({ data: [...stato.suStripe].reverse().map((r) => ({ ...r, metadata: { ...r.metadata } })), has_more: false }),
      update: async (id: string, p: { metadata?: Record<string, string> }) => {
        const r = stato.suStripe.find((x) => x.id === id);
        if (!r) throw new Error(`No such refund: ${id}`);
        r.metadata = { ...r.metadata, ...(p.metadata ?? {}) };
        return { ...r };
      },
      create: async () => {
        throw new Error('in questa prova il sito non rimborsa niente da sé');
      },
    },
    transfers: { createReversal: async (_t: string, _p: unknown, o: { idempotencyKey: string }) => ({ id: `trr_${o.idempotencyKey}` }), list: async () => ({ data: [] }) },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';
import { POST as chiudiIlReclamo } from '@/app/api/admin/disputes/[id]/resolve/route';
import { GET as elencoDaDividere, POST as dividiDalPannello } from '@/app/api/admin/orders/rimborsi-da-dividere/route';

function ordine(extra: Riga): Riga {
  return {
    user_id: 'cliente1', payment_method: 'card', payment_status: 'PAID', delivery_status: 'DELIVERED',
    refunded_amount_cents: 0, payout_status: 'HELD', payout_tentativo: 0, seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1', stripe_charge_id: 'ch_1', stripe_transfer_id: null, stripe_reversal_id: null,
    stripe_refund_id: null, internal_dispute_status: null, dispute_status: null, coupon_code: null, wallet_applied_cents: 0,
    cash_confirmed_at: null, rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: null, shipping_cost: 0, ...extra,
  };
}

const riga = (id: string) => stato.db.tabelle.orders!.find((r) => r.id === id)!;

async function rimborsoDalCruscotto(centesimi: number): Promise<void> {
  stato.refunded += centesimi;
  stato.suStripe.push({ id: `re_cruscotto_${stato.suStripe.length + 1}`, amount: centesimi, status: 'succeeded', metadata: {}, created: ++orologio });
  await handleChargeRefunded({ id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: 2790, amount_refunded: stato.refunded } as never);
}

async function chiudi(corpo: Record<string, unknown>): Promise<number> {
  const res = await (chiudiIlReclamo as unknown as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ id: 'd1' }) },
  );
  return res.status;
}

async function pannello(): Promise<Array<Record<string, unknown>>> {
  const res = await (elencoDaDividere as unknown as (req: Request) => Promise<Response>)(new Request('http://x'));
  const corpo = (await res.json()) as { data: { carrelli: Array<Record<string, unknown>> } };
  return corpo.data.carrelli;
}

async function dividi(parti: Array<{ ordine: string; centesimi: number }>): Promise<{ status: number; corpo: string }> {
  const res = await (dividiDalPannello as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pagamento: 'pi_1', parti }) }),
  );
  return { status: res.status, corpo: await res.text() };
}

/** Lo stesso filtro con cui il giro dei bonifici sceglie chi pagare (app/api/cron/release-payouts). */
async function pagabili(): Promise<string[]> {
  const { data } = (await stato.db.client
    .from('orders')
    .select('id')
    .or('internal_dispute_status.is.null,internal_dispute_status.eq.RESOLVED')) as { data: Riga[] };
  return data.map((r) => String(r.id)).sort();
}

beforeEach(() => {
  stato.refunded = 0;
  stato.suStripe = [];
  stato.db = fintoDatabase({
    orders: [
      ordine({ id: 'pane01', seller_id: 'pane', total_price: 15, gross_total_cents: 1500, seller_payout_cents: 1000 }),
      ordine({ id: 'fiori1', seller_id: 'fiori', total_price: 12.9, gross_total_cents: 1290, seller_payout_cents: 900 }),
    ],
    disputes: [{ id: 'd1', status: 'open', order_id: 'pane01', opener_id: 'cliente1', against_id: 'pane' }],
    profiles: [
      { id: 'admin1', role: 'admin' },
      { id: 'pane', role: 'seller', store_name: 'Pane Quotidiano' },
      { id: 'fiori', role: 'seller', store_name: 'Il fioraio' },
    ],
    notifications: [],
    audit_logs: [],
    bonifici_dei_reclami: [],
    activity_events: [],
  });
});

describe('il reclamo chiuso su un ordine di un carrello fermo per un rimborso dal cruscotto', () => {
  it('IL CASO DEL RIESAME — la pausa resta, il pane non torna pagabile, e i 3 € si danno al pane', async () => {
    await rimborsoDalCruscotto(300);
    expect(await pagabili(), 'il webhook non ha fermato il carrello').toEqual([]);

    expect(await chiudi({ status: 'resolved_buyer', notes: 'rimborsato dal cruscotto stripe' })).toBe(200);

    expect(riga('pane01').internal_dispute_status, 'chiudere il reclamo ha tolto la pausa al pane').toBe('RIMBORSO_DA_RIPARTIRE');
    expect(await pagabili(), 'il pane torna pagabile col netto intero prima che il rimborso sia diviso').toEqual([]);
    const avviso = stato.db.tabelle.notifications!.find((n) => String(n.title).includes('bonifico ancora fermo'));
    expect(avviso, 'chi chiude il reclamo non sa che il bonifico resta fermo').toBeDefined();

    const carrelli = await pannello();
    expect(carrelli).toEqual([
      expect.objectContaining({
        daDividereCents: 300,
        ordini: [expect.objectContaining({ id: 'pane01', fermo: true }), expect.objectContaining({ id: 'fiori1', fermo: true })],
      }),
    ]);

    const divisione = await dividi([{ ordine: 'pane01', centesimi: 300 }, { ordine: 'fiori1', centesimi: 0 }]);
    expect(divisione.status, divisione.corpo).toBe(200);
    // 300 × 1000 ÷ 1500 = 200: la quota la paga Pane Quotidiano, non il fioraio.
    expect(riga('pane01')).toMatchObject({ refunded_amount_cents: 300, seller_payout_reversed_cents: 200 });
    expect(riga('fiori1')).toMatchObject({ refunded_amount_cents: 0, seller_payout_reversed_cents: 0 });
    expect(await pagabili()).toEqual(['fiori1', 'pane01']);
  });

  it('un reclamo chiuso su un ordine senza pausa scrive il suo esito come sempre', async () => {
    expect(await chiudi({ status: 'resolved_buyer', notes: 'il negozio ha riconsegnato il pane' })).toBe(200);
    expect(riga('pane01').internal_dispute_status).toBe('RESOLVED');
    expect(stato.db.tabelle.notifications!.filter((n) => String(n.title).includes('bonifico ancora fermo'))).toEqual([]);
  });
});

describe('la divisione vede anche gli ordini del pagamento che il webhook non ha fermato', () => {
  it('IL CASO DEL RIESAME — reclamo aperto sui fiori, 3 € di fiori dal cruscotto: la parte si dà ai fiori', async () => {
    // Un reclamo in corso sui fiori: il webhook ferma solo gli ordini pagabili.
    riga('fiori1').internal_dispute_status = 'OPEN';
    await rimborsoDalCruscotto(300);
    expect(riga('pane01').internal_dispute_status).toBe('RIMBORSO_DA_RIPARTIRE');
    expect(riga('fiori1').internal_dispute_status).toBe('OPEN');

    const carrelli = await pannello();
    expect(carrelli[0]).toMatchObject({
      daDividereCents: 300,
      ordini: [expect.objectContaining({ id: 'pane01', fermo: true }), expect.objectContaining({ id: 'fiori1', fermo: false, restaCents: 1290 })],
    });

    const divisione = await dividi([{ ordine: 'pane01', centesimi: 0 }, { ordine: 'fiori1', centesimi: 300 }]);

    expect(divisione.status, divisione.corpo).toBe(200);
    // 300 × 900 ÷ 1290 = 209: al fioraio, che il rimborso l'ha avuto davvero.
    expect(riga('fiori1')).toMatchObject({ refunded_amount_cents: 300, seller_payout_reversed_cents: 209, internal_dispute_status: 'OPEN' });
    expect(riga('pane01')).toMatchObject({ refunded_amount_cents: 0, seller_payout_reversed_cents: 0, internal_dispute_status: null });
  });

  it('la parte di un ordine non fermo, se non si scrive, vale zero', async () => {
    riga('fiori1').internal_dispute_status = 'OPEN';
    await rimborsoDalCruscotto(300);

    const divisione = await dividi([{ ordine: 'pane01', centesimi: 300 }]);

    expect(divisione.status, divisione.corpo).toBe(200);
    expect(riga('pane01')).toMatchObject({ refunded_amount_cents: 300, internal_dispute_status: null });
    expect(riga('fiori1')).toMatchObject({ refunded_amount_cents: 0, internal_dispute_status: 'OPEN' });
  });

  it('la parte di un ordine fermo invece va scritta, anche zero', async () => {
    await rimborsoDalCruscotto(300);
    const divisione = await dividi([{ ordine: 'fiori1', centesimi: 300 }]);
    expect(divisione.status).toBe(400);
    expect(divisione.corpo).toContain('Manca la parte');
    expect(riga('fiori1').refunded_amount_cents).toBe(0);
  });
});
