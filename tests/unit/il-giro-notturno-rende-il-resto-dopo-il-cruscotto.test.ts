import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 — IL GIRO NOTTURNO ANNULLAVA L'ORDINE E SI TENEVA IL RESTO.
 *
 * Il caso: un cliente paga 27,90 € con la carta da Pane Quotidiano, l'ordine
 * resta «nuovo». Manca una focaccia e Nicola rimborsa 3 € dal cruscotto Stripe:
 * il webhook scrive 3 € rimborsati e porta il pagamento a «rimborsato in
 * parte». Il negozio non accetta in tempo e il giro degli ordini fermi
 * (`expire-stale-orders`) lo annulla. Il giro riconosceva come pagati con
 * carta solo gli ordini «PAID»: questo lo trattava come un contrassegno, lo
 * annullava senza rimborsare niente, e al cliente restavano da avere 24,90 €.
 *
 * La prova fa girare il gestore VERO del webhook e il giro VERO, contro un
 * database finto e uno Stripe finto che, come quello vero, rifiuta un rimborso
 * più grande di quanto resta sul pagamento.
 */

type RimborsoSuStripe = { id: string; amount: number; status: string; metadata: Record<string, string>; chiave: string | null };
const stato: {
  db: FintoDatabase;
  carica: { amount: number; refunded: number };
  suStripe: RimborsoSuStripe[];
} = { db: fintoDatabase(), carica: { amount: 2790, refunded: 0 }, suStripe: [] };

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: async (p: { amount: number; metadata?: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = stato.suStripe.find((r) => r.chiave === o.idempotencyKey);
        if (gia) return { id: gia.id, status: gia.status };
        const resta = stato.carica.amount - stato.carica.refunded;
        if (p.amount > resta) {
          throw new Error(`Refund amount (${p.amount}) is greater than unrefunded amount on charge (${resta})`);
        }
        stato.carica.refunded += p.amount;
        const nuovo = { id: `re_${stato.suStripe.length + 1}`, amount: p.amount, status: 'succeeded', metadata: p.metadata ?? {}, chiave: o.idempotencyKey };
        stato.suStripe.push(nuovo);
        return { id: nuovo.id, status: nuovo.status };
      },
      list: async () => ({ data: stato.suStripe.map((r) => ({ ...r })), has_more: false }),
      update: async (id: string, p: { metadata?: Record<string, string> }) => {
        const r = stato.suStripe.find((x) => x.id === id);
        if (r) r.metadata = { ...r.metadata, ...(p.metadata ?? {}) };
        return r;
      },
    },
    transfers: {
      createReversal: async () => ({ id: 'trr_1' }),
      list: async () => ({ data: [] }),
      create: async () => ({ id: 'tr_1' }),
    },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';
import { restaDaRimborsareSullaCarta } from '@/lib/ordini/soldi-sulla-carta';
import { decidiRimessaAScaffale } from '@/lib/ordini/rimessa-a-scaffale';

function ordineNuovoDiPaneQuotidiano(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    user_id: 'cliente1',
    seller_id: 'pane-quotidiano',
    total_price: 27.9,
    gross_total_cents: 2790,
    refunded_amount_cents: 0,
    payment_method: 'card',
    payment_status: 'PAID',
    delivery_status: 'NEW',
    // Quattro ore fa, senza fascia: oltre le tre ore che il negozio ha per accettare.
    created_at: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    delivery_slot: null,
    payout_status: 'HELD',
    payout_tentativo: 0,
    seller_payout_cents: 1800,
    seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_session_id: 'cs_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    internal_dispute_status: null,
    coupon_code: null,
    wallet_applied_cents: 0,
    rider_id: null,
    rider_transfer_id: null,
    rider_payout_status: null,
    rider_payout_reversed_cents: 0,
    rider_fee_cents: null,
    shipping_cost: 4.9,
    ...extra,
  };
}

/** Nicola rimborsa dal cruscotto: i soldi escono da Stripe, poi arriva l'avviso. */
async function rimborsoDalCruscotto(centesimi: number): Promise<void> {
  stato.carica.refunded += centesimi;
  stato.suStripe.push({ id: `re_cruscotto_${stato.suStripe.length + 1}`, amount: centesimi, status: 'succeeded', metadata: {}, chiave: null });
  await handleChargeRefunded({
    id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: stato.carica.amount, amount_refunded: stato.carica.refunded,
  } as unknown as Parameters<typeof handleChargeRefunded>[0]);
}

async function giroNotturno(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return res.json();
}

const ordine = () => stato.db.tabelle.orders!.find((r) => r.id === 'o1')!;

beforeEach(() => {
  stato.carica = { amount: 2790, refunded: 0 };
  stato.suStripe = [];
  stato.db = fintoDatabase({
    orders: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
  });
  stato.db.rispostaRpc = (nome, a) => {
    const riga = stato.db.tabelle.orders!.find((r) => r.id === a.p_order_id);
    if (nome === 'accumula_rimborso' && riga) {
      const tot = Number(riga.gross_total_cents ?? Math.round(Number(riga.total_price) * 100));
      const nuovo = Number(riga.refunded_amount_cents ?? 0) + Number(a.p_delta);
      if (nuovo > tot) return { data: [], error: null };
      riga.refunded_amount_cents = nuovo;
      return { data: [{ totale_rimborsato: nuovo, totale_ordine: tot }], error: null };
    }
    if (nome === 'storna_rimborso' && riga) {
      riga.refunded_amount_cents = Number(riga.refunded_amount_cents ?? 0) - Number(a.p_delta);
    }
    return { data: null, error: null };
  };
});

describe('il giro degli ordini mai accettati, dopo un rimborso parziale dal cruscotto', () => {
  it('IL CASO DELLA SCHEDA — 3 € dal cruscotto, il negozio non accetta: il giro annulla e rende i 24,90 € che restano', async () => {
    stato.db.tabelle.orders = [ordineNuovoDiPaneQuotidiano()];
    await rimborsoDalCruscotto(300);
    expect(ordine().payment_status).toBe('PARTIALLY_REFUNDED');

    const giro = await giroNotturno();

    expect(giro).toMatchObject({ canceled: 1, refunded: 1, failed: 0, daChiudereAMano: 0 });
    expect(ordine().delivery_status).toBe('CANCELED');
    expect(stato.carica.refunded, 'ordine annullato ma al cliente restano da rendere 24,90 €').toBe(2790);
    expect(ordine()).toMatchObject({ refunded_amount_cents: 2790, payment_status: 'REFUNDED' });
    const avviso = stato.db.tabelle.notifications!.find((n) => n.user_id === 'cliente1');
    expect(String(avviso?.body), 'al cliente si dice che il rimborso è partito').toContain('Il rimborso è in corso');
  });

  it('un ordine pagato e mai rimborsato si rende per intero, come prima', async () => {
    stato.db.tabelle.orders = [ordineNuovoDiPaneQuotidiano()];
    const giro = await giroNotturno();
    expect(giro).toMatchObject({ canceled: 1, refunded: 1 });
    expect(stato.carica.refunded).toBe(2790);
  });

  it('un contrassegno mai accettato si annulla senza chiedere niente a Stripe', async () => {
    stato.db.tabelle.orders = [ordineNuovoDiPaneQuotidiano({ payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null })];
    const giro = await giroNotturno();
    expect(giro).toMatchObject({ canceled: 1, refunded: 0 });
    expect(stato.carica.refunded).toBe(0);
    expect(ordine()).toMatchObject({ delivery_status: 'CANCELED', payment_status: 'FAILED' });
  });
});

/** Quante volte il database ha rimesso a scaffale la merce di quell'ordine. */
const rimesseAScaffale = (id = 'o1') =>
  stato.db.rpc.filter((c) => c.nome === 'restore_stock_for_order' && c.argomenti.p_order_id === id).length;

describe('la merce dell ordine annullato dal giro torna a scaffale (riesame del 16/10)', () => {
  it('IL CASO DEL RIESAME — 3 € dal cruscotto, il negozio non accetta: il giro rende il resto E rimette la merce', async () => {
    stato.db.tabelle.orders = [ordineNuovoDiPaneQuotidiano()];
    await rimborsoDalCruscotto(300);

    const giro = await giroNotturno();

    expect(giro).toMatchObject({ canceled: 1, refunded: 1 });
    expect(rimesseAScaffale(), 'il magazzino del negozio perde per sempre le quantità di un ordine che nessuno ha comprato').toBe(1);
  });

  it('un ordine pagato e mai rimborsato rimette la merce una volta, come prima', async () => {
    stato.db.tabelle.orders = [ordineNuovoDiPaneQuotidiano()];
    await giroNotturno();
    expect(rimesseAScaffale()).toBe(1);
  });

  it('la regola: un annullo fatto adesso da chi chiama rimette la merce, anche dopo un rimborso parziale', () => {
    const annullatoDalGiro = { delivery_status: 'CANCELED' };
    expect(decidiRimessaAScaffale({ ordineDaChiudere: true, ordine: annullatoDalGiro, giaRimborsatoPrimaCents: 300, annullatoDaChiChiama: true }))
      .toEqual({ rimetti: true });
    // Senza la bandiera resta la regola di prima: un ordine già annullato con un rimborso precedente.
    expect(decidiRimessaAScaffale({ ordineDaChiudere: true, ordine: annullatoDalGiro, giaRimborsatoPrimaCents: 300 }))
      .toEqual({ rimetti: false, perche: 'gia-chiuso-da-un-rimborso' });
  });
});

describe('quando restano soldi sulla carta da restituire', () => {
  const carta = { payment_method: 'card', stripe_payment_intent: 'pi_1' };
  it('pagato, oppure rimborsato solo in parte', () => {
    expect(restaDaRimborsareSullaCarta({ ...carta, payment_status: 'PAID' })).toBe(true);
    expect(restaDaRimborsareSullaCarta({ ...carta, payment_status: 'PARTIALLY_REFUNDED' })).toBe(true);
  });
  it('non se è già tutto rimborsato, o il pagamento non è mai arrivato', () => {
    expect(restaDaRimborsareSullaCarta({ ...carta, payment_status: 'REFUNDED' })).toBe(false);
    expect(restaDaRimborsareSullaCarta({ ...carta, payment_status: 'PENDING' })).toBe(false);
    expect(restaDaRimborsareSullaCarta({ ...carta, payment_status: 'FAILED' })).toBe(false);
  });
  it('non sui contanti, e non senza il pagamento Stripe', () => {
    expect(restaDaRimborsareSullaCarta({ payment_method: 'cod', stripe_payment_intent: null, payment_status: 'PAID' })).toBe(false);
    expect(restaDaRimborsareSullaCarta({ payment_method: 'card', stripe_payment_intent: null, payment_status: 'PAID' })).toBe(false);
  });
});
