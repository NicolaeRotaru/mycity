import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 (riesame del lotto) — SU UN CARRELLO DI DUE NEGOZI, L'ANNULLO
 * RENDEVA DI NUOVO QUELLO CHE IL CRUSCOTTO AVEVA GIÀ RESO.
 *
 * Il caso: un carrello pagato con la carta, Pane Quotidiano 27,90 € e un
 * fioraio 30,00 €, un solo pagamento da 57,90 €. Manca una focaccia e Nicola
 * rende 3 € dal cruscotto Stripe. Stripe non dice di quale negozio sono: il
 * webhook ferma i bonifici dei due ordini e non scrive niente sugli ordini.
 * Poi Pane Quotidiano non accetta in tempo e il giro notturno lo annulla
 * (oppure lo annulla il cliente). L'annullo guardava solo il rimborsato scritto
 * sull'ordine — zero — e chiedeva a Stripe 27,90 €: Stripe li dava, perché sul
 * pagamento ne restavano 54,90. Il cliente riceveva 30,90 € per un ordine da
 * 27,90, e i 3 € da dividere si potevano mettere solo sul fioraio, che perdeva
 * la quota di una focaccia non sua.
 *
 * Adesso prima si divide, poi si annulla: finché il rimborso dal cruscotto non è
 * diviso l'annullo con la carta su quel pagamento aspetta, e dopo la divisione
 * rende solo quello che manca.
 *
 * La prova fa girare il webhook VERO, la rotta VERA del cliente, il giro VERO e
 * la divisione VERA dal pannello, contro un database finto e uno Stripe finto
 * che, come quello vero, rende finché sul pagamento c'è qualcosa.
 */

type RimborsoSuStripe = { id: string; amount: number; status: string; metadata: Record<string, string>; created: number; chiave: string | null };
const stato: {
  db: FintoDatabase;
  carica: { amount: number; refunded: number };
  suStripe: RimborsoSuStripe[];
} = { db: fintoDatabase(), carica: { amount: 5790, refunded: 0 }, suStripe: [] };
let orologio = 1_800_000_000;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
  withAdminAuth: (h: (ctx: unknown) => unknown) => (req: unknown) =>
    h({ req, user: { id: 'admin1' }, profile: { role: 'admin' }, params: {} }),
  withAuthRateLimit:
    (_o: unknown, h: (ctx: unknown) => unknown) =>
    async (req: unknown, ctx?: { params: Promise<Record<string, string>> }) =>
      h({ req, user: { id: 'cliente1' }, params: (await ctx?.params) ?? {} }),
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
      createReversal: async (_t: string, _p: unknown, o: { idempotencyKey: string }) => ({ id: `trr_${o.idempotencyKey}` }),
      list: async () => ({ data: [] }),
    },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';
import { annullaERimborsa, type OrdineDaAnnullare } from '@/lib/ordini/annulla';
import { POST as dividiDalPannello } from '@/app/api/admin/orders/rimborsi-da-dividere/route';
import { POST as annullaDalCliente } from '@/app/api/orders/[id]/cancel/route';

const QUATTRO_ORE_FA = () => new Date(Date.now() - 4 * 3_600_000).toISOString();

function ordine(extra: Riga): Riga {
  return {
    user_id: 'cliente1',
    payment_method: 'card',
    payment_status: 'PAID',
    refunded_amount_cents: 0,
    payout_status: 'HELD',
    payout_tentativo: 0,
    seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_session_id: 'cs_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    stripe_refund_id: null,
    internal_dispute_status: null,
    coupon_code: null,
    wallet_applied_cents: 0,
    cash_confirmed_at: null,
    created_at: QUATTRO_ORE_FA(),
    delivery_slot: null,
    rider_id: null,
    rider_transfer_id: null,
    rider_payout_status: null,
    rider_payout_reversed_cents: 0,
    rider_fee_cents: null,
    shipping_cost: 0,
    ...extra,
  };
}

const riga = (id: string) => stato.db.tabelle.orders!.find((r) => r.id === id)!;

/** Nicola rende 3 € dal cruscotto: i soldi escono da Stripe, poi arriva l'avviso. */
async function rimborsoDalCruscotto(centesimi: number): Promise<void> {
  stato.carica.refunded += centesimi;
  stato.suStripe.push({ id: `re_cruscotto_${stato.suStripe.length + 1}`, amount: centesimi, status: 'succeeded', metadata: {}, created: ++orologio, chiave: null });
  await handleChargeRefunded({
    id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: stato.carica.amount, amount_refunded: stato.carica.refunded,
  } as unknown as Parameters<typeof handleChargeRefunded>[0]);
}

async function giroNotturno(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return res.json();
}

async function dividi(parti: Array<{ ordine: string; centesimi: number }>): Promise<number> {
  const res = await (dividiDalPannello as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pagamento: 'pi_1', parti }) }),
  );
  return res.status;
}

async function ilClienteAnnulla(id: string): Promise<{ status: number; corpo: string }> {
  const res = await (annullaDalCliente as unknown as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request(`http://x/api/orders/${id}/cancel`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, corpo: await res.text() };
}

const stornoAScaffale = (id: string) =>
  stato.db.rpc.filter((c) => c.nome === 'restore_stock_for_order' && c.argomenti.p_order_id === id).length;

beforeEach(() => {
  stato.carica = { amount: 5790, refunded: 0 };
  stato.suStripe = [];
  stato.db = fintoDatabase({
    orders: [
      // Pane Quotidiano: ancora da accettare, oltre le tre ore che il negozio ha.
      ordine({ id: 'pane01', seller_id: 'pane-quotidiano', delivery_status: 'NEW', total_price: 27.9, gross_total_cents: 2790, seller_payout_cents: 1800 }),
      // Il fioraio: già accettato, non scade.
      ordine({ id: 'fiori1', seller_id: 'fioraio', delivery_status: 'ACCEPTED', total_price: 30, gross_total_cents: 3000, seller_payout_cents: 2000 }),
    ],
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

describe('un carrello di due negozi con un rimborso dal cruscotto ancora da dividere', () => {
  it('IL CASO DELLA SCHEDA — Pane Quotidiano non accetta: il giro aspetta la divisione, poi rende solo i 24,90 € che mancano', async () => {
    await rimborsoDalCruscotto(300);
    expect(riga('pane01').internal_dispute_status, 'il webhook non ha fermato il carrello').toBe('RIMBORSO_DA_RIPARTIRE');

    const primo = await giroNotturno();
    expect(primo).toMatchObject({ canceled: 0, refunded: 0, inAttesaDellaDivisione: 1 });
    expect(stato.carica.refunded, 'il giro ha reso di nuovo il lordo intero: 30,90 € per un ordine da 27,90').toBe(300);
    expect(riga('pane01').delivery_status).toBe('NEW');

    // Nicola divide: i 3 € erano della focaccia di Pane Quotidiano.
    expect(await dividi([{ ordine: 'pane01', centesimi: 300 }, { ordine: 'fiori1', centesimi: 0 }])).toBe(200);

    const secondo = await giroNotturno();
    expect(secondo).toMatchObject({ canceled: 1, refunded: 1, inAttesaDellaDivisione: 0 });
    expect(stato.carica.refunded, 'al cliente di Pane Quotidiano deve tornare 27,90 € in tutto, non di più').toBe(2790);
    expect(riga('pane01')).toMatchObject({ delivery_status: 'CANCELED', refunded_amount_cents: 2790, payment_status: 'REFUNDED' });
    // Il fioraio non c'entra: niente rimborsato, niente quota tolta.
    expect(riga('fiori1')).toMatchObject({ refunded_amount_cents: 0, seller_payout_reversed_cents: 0, internal_dispute_status: null });
    // E la merce di Pane Quotidiano torna a scaffale, una volta.
    expect(stornoAScaffale('pane01')).toBe(1);
  });

  it('il cliente che annulla dal sito aspetta la divisione, gli amministratori lo sanno, e dopo riceve solo il resto', async () => {
    await rimborsoDalCruscotto(300);

    const prima = await ilClienteAnnulla('pane01');
    expect(prima.status).toBe(409);
    expect(prima.corpo).toContain('rimborso ancora da sistemare');
    expect(stato.carica.refunded, 'l annullo ha reso di nuovo il lordo intero').toBe(300);
    expect(riga('pane01')).toMatchObject({ delivery_status: 'NEW', refunded_amount_cents: 0 });
    const avvisi = stato.db.tabelle.notifications!.filter((n) => n.user_id === 'admin1' && String(n.title).includes('Annullo in attesa'));
    expect(avvisi, 'nessuno sa che un cliente vuole annullare').toHaveLength(1);

    expect(await dividi([{ ordine: 'pane01', centesimi: 300 }, { ordine: 'fiori1', centesimi: 0 }])).toBe(200);

    const dopo = await ilClienteAnnulla('pane01');
    expect(dopo.status).toBe(200);
    expect(stato.carica.refunded).toBe(2790);
    expect(riga('pane01')).toMatchObject({ delivery_status: 'CANCELED', refunded_amount_cents: 2790 });
  });

  it('se i 3 € erano del fioraio, l annullo di Pane Quotidiano rende tutti i suoi 27,90 €', async () => {
    await rimborsoDalCruscotto(300);
    expect(await dividi([{ ordine: 'pane01', centesimi: 0 }, { ordine: 'fiori1', centesimi: 300 }])).toBe(200);

    const giro = await giroNotturno();

    expect(giro).toMatchObject({ canceled: 1, refunded: 1 });
    expect(stato.carica.refunded).toBe(300 + 2790);
    expect(riga('pane01')).toMatchObject({ refunded_amount_cents: 2790, payment_status: 'REFUNDED' });
    expect(riga('fiori1')).toMatchObject({ refunded_amount_cents: 300 });
  });

  it('basta la pausa sull altro ordine dello stesso pagamento: un ordine col reclamo aperto non si rimborsa per intero', async () => {
    // Un reclamo in corso su Pane Quotidiano: il webhook non gli mette la pausa,
    // ma i 3 € dal cruscotto possono essere suoi.
    riga('pane01').internal_dispute_status = 'OPEN';
    await rimborsoDalCruscotto(300);
    expect(riga('pane01').internal_dispute_status).toBe('OPEN');
    expect(riga('fiori1').internal_dispute_status).toBe('RIMBORSO_DA_RIPARTIRE');

    const esito = await annullaERimborsa(stato.db.client as never, { ...riga('pane01') } as unknown as OrdineDaAnnullare, {
      reason: 'annullato dall amministrazione',
    });

    expect(esito).toEqual({ ok: false, motivo: 'RIMBORSO_DA_DIVIDERE' });
    expect(stato.carica.refunded).toBe(300);
  });

  it('senza nessun rimborso da dividere l annullo resta quello di sempre', async () => {
    const esito = await ilClienteAnnulla('pane01');
    expect(esito.status).toBe(200);
    expect(stato.carica.refunded).toBe(2790);
    expect(riga('pane01')).toMatchObject({ delivery_status: 'CANCELED', refunded_amount_cents: 2790 });
  });
});
