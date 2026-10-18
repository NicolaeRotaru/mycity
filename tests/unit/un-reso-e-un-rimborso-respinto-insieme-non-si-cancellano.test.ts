import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 (quinto riesame del lotto) — LA BANCA RESPINGE UN RIMBORSO MENTRE
 * SULLO STESSO ORDINE NE PARTE UN ALTRO: IL SEGNO «GIÀ FATTO» SPARIVA E LA
 * QUOTA DEL NEGOZIO VENIVA SOVRASCRITTA.
 *
 * Il caso: ordine da 40 € col bonifico al negozio ancora trattenuto, 15 €
 * rimborsati (re_1 da 10 e re_2 da 5), quota del negozio tolta 12,15 €. Parte
 * un reso da 5 € (re_3) e, nello stesso secondo, la banca respinge re_2.
 * `refundOrder` legge l'ordine all'inizio e alla fine riscriveva quota ed
 * elenco dei rimborsi da quella lettura: la quota tolta finiva a 16,20 €
 * invece di 12,15 (4,05 € in meno al negozio) e il segno del rimborso respinto
 * spariva; alla riconsegna dello stesso avviso il rimborsato scendeva a 10 €
 * invece di 15 e agli amministratori arrivavano due avvisi.
 *
 * Qui girano `refundOrder` VERO e il gestore VERO del rimborso respinto, che
 * parte DAVVERO mentre `refundOrder` sta chiedendo il reso a Stripe, in tutti
 * i momenti possibili (un passo alla volta), su un database finto che applica
 * i filtri come PostgREST. Se il gestore lancia, Stripe lo riprova.
 */

/** Quello che succede mentre Stripe fa il reso: se restituisce una promessa, Stripe risponde solo dopo. */
const stato: { db: FintoDatabase; durante: (() => Promise<unknown> | void) | null } = { db: fintoDatabase(), durante: null };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      // Mentre Stripe fa il reso, arriva l'avviso del rimborso respinto.
      create: async () => {
        const f = stato.durante;
        stato.durante = null;
        await f?.();
        return { id: 're_3', status: 'succeeded' };
      },
      list: async () => ({ data: [], has_more: false }),
    },
  }),
}));

import { refundOrder } from '@/lib/stripe/payout';
import { handleRefundUpdated } from '@/lib/stripe/webhook/rimborsi';

const respintoRe2 = () =>
  handleRefundUpdated({ id: 're_2', status: 'failed', amount: 500, payment_intent: 'pi_1', metadata: { order_id: 'o1' } } as never);

const ordine = () => stato.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const avvisi = () => stato.db.tabelle.notifications!.filter((n) => n.title === '⚠️ Rimborso rifiutato dalla banca');

function daCapo(): void {
  stato.db = fintoDatabase({
    orders: [{
      id: 'o1', user_id: 'cliente1', total_price: 40, gross_total_cents: 4000, refunded_amount_cents: 1500,
      payment_status: 'PARTIALLY_REFUNDED', payout_status: 'HELD', payment_method: 'card',
      stripe_payment_intent: 'pi_1', stripe_transfer_id: null, stripe_reversal_id: null,
      seller_payout_cents: 3240, seller_payout_reversed_cents: 1215, payout_tentativo: 0,
      stripe_refund_id: 're_1,re_2', delivery_status: 'DELIVERED', internal_dispute_status: null,
      rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
      rider_fee_cents: 0, shipping_cost: 0, cash_confirmed_at: null, wallet_applied_cents: 0,
    }],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
  });
  stato.db.rispostaRpc = (nome, a) => {
    const o = ordine();
    if (nome === 'accumula_rimborso') {
      const nuovo = Number(o.refunded_amount_cents ?? 0) + Number(a.p_delta);
      if (nuovo > 4000) return { data: [], error: null };
      o.refunded_amount_cents = nuovo;
      return { data: [{ totale_rimborsato: nuovo, totale_ordine: 4000 }], error: null };
    }
    if (nome === 'storna_rimborso') o.refunded_amount_cents = Number(o.refunded_amount_cents ?? 0) - Number(a.p_delta);
    return { data: null, error: null };
  };
}

/** Il gestore del rimborso respinto come lo fa girare Stripe: se lancia, riprova (fino a tre volte). */
async function comeStripe(primo: Promise<unknown>): Promise<'subito' | 'ritentato'> {
  try {
    await primo;
    return 'subito';
  } catch {
    for (let i = 0; i < 3; i++) {
      try {
        await respintoRe2();
        return 'ritentato';
      } catch {
        // ritenta
      }
    }
    throw new Error('il gestore del rimborso respinto non passa nemmeno ritentando');
  }
}

/** Il giusto: il cliente ha avuto re_1 (10 €) e re_3 (5 €); al negozio tolte le quote di quei due, 8,10 + 4,05. */
function ilContoTorna(quando: string): void {
  expect(ordine().refunded_amount_cents, `${quando}: rimborsato`).toBe(1500);
  expect(ordine().seller_payout_reversed_cents, `${quando}: quota tolta al negozio`).toBe(1215);
  const elenco = String(ordine().stripe_refund_id).split(',');
  expect(elenco, `${quando}: il reso nuovo nell elenco`).toContain('re_3');
  expect(elenco, `${quando}: il segno del rimborso respinto`).toContain('respinto:500:re_2');
  expect(avvisi(), `${quando}: avvisi agli amministratori`).toHaveLength(1);
}

beforeEach(daCapo);

describe('un reso nuovo e un rimborso respinto sullo stesso ordine, insieme', () => {
  it('IL CASO DEL RIESAME — il respinto arriva tutto mentre Stripe fa il reso: quota e segno restano giusti, anche alla riconsegna', async () => {
    // Stripe risponde al reso solo dopo che il gestore del respinto ha finito.
    stato.durante = () => respintoRe2();
    await refundOrder({ orderId: 'o1', amountCents: 500, notifyBuyer: false });
    ilContoTorna('dopo il reso');

    // Stripe riconsegna lo stesso avviso.
    await respintoRe2();
    ilContoTorna('dopo la riconsegna');
  });

  it('in ogni momento in cui il respinto può arrivare, i conti tornano', async () => {
    const esiti = new Map<string, number[]>();
    for (let passi = 0; passi <= 60; passi++) {
      daCapo();
      let gestore: Promise<unknown> = Promise.resolve();
      // Il gestore parte mentre Stripe fa il reso, e `refundOrder` va avanti senza aspettarlo.
      stato.durante = () => {
        gestore = (async () => {
          for (let i = 0; i < passi; i++) await Promise.resolve();
          return respintoRe2();
        })();
        gestore.catch(() => {});
      };
      await refundOrder({ orderId: 'o1', amountCents: 500, notifyBuyer: false });
      const come = await comeStripe(gestore);
      esiti.set(come, [...(esiti.get(come) ?? []), passi]);
      ilContoTorna(`respinto dopo ${passi} passi`);
      await respintoRe2();
      ilContoTorna(`respinto dopo ${passi} passi, poi riconsegnato`);
    }
    // La prova vale solo se le due chiamate si sono incrociate davvero: in
    // qualche momento il gestore ha letto prima e scritto dopo `refundOrder`.
    expect(esiti.get('ritentato')?.length ?? 0, 'nessun incrocio: la prova non ha visto la corsa').toBeGreaterThan(0);
    expect(esiti.get('subito')?.length ?? 0).toBeGreaterThan(0);
  });

  it('senza nessuno in mezzo il reso scrive come prima', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 500, notifyBuyer: false });
    expect(ordine()).toMatchObject({ refunded_amount_cents: 2000, seller_payout_reversed_cents: 1620, stripe_refund_id: 're_1,re_2,re_3' });
  });

  it('una lettura vecchia dell ordine col campo vuoto non blocca la quota', async () => {
    (ordine() as Riga).seller_payout_reversed_cents = null;
    await refundOrder({ orderId: 'o1', amountCents: 500, notifyBuyer: false });
    expect(ordine().seller_payout_reversed_cents).toBe(405);
  });
});
