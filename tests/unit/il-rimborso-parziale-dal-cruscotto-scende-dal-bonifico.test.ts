import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 15/10/2026 (R85) — UN RIMBORSO PARZIALE FATTO DAL CRUSCOTTO STRIPE VENIVA
 * IGNORATO: IL NEGOZIO PRENDEVA IL BONIFICO INTERO E L'ANNULLO DOPO NON
 * FUNZIONAVA PIÙ.
 *
 * Il caso della scheda: un cliente ordina da Pane Quotidiano per 27,90 € con la
 * carta (20 € di prodotti, 4,90 € di spedizione, 3 € di consegna). Manca una
 * focaccia da 3 € e Nicola la rimborsa dal cruscotto Stripe, che è il posto più
 * naturale. Il webhook scriveva un avviso nei log e basta:
 *   ① il giro dei bonifici versava al negozio 18,00 € pieni — la sua parte dei
 *     3 € la pagava MyCity;
 *   ② se poi l'ordine veniva annullato, il sito chiedeva a Stripe 27,90 € quando
 *     ne restavano 24,90: Stripe rifiutava, e l'ordine restava pagato e non
 *     annullabile dal sito.
 *
 * Questa prova fa girare il gestore VERO, poi le funzioni VERE che vengono dopo
 * — il bonifico al negozio (`releaseOrderPayout`) e l'annullo
 * (`annullaERimborsa`) — contro un database finto e uno Stripe finto che, come
 * quello vero, rifiuta un rimborso più grande di quanto resta sul pagamento.
 */

type Carica = { amount: number; refunded: number };
/** Un rimborso come lo tiene Stripe: quelli di `refundOrder` portano `metadata.order_id`. */
type RimborsoSuStripe = { id: string; amount: number; status: string; metadata: Record<string, string>; chiave: string | null };
const stato: {
  db: FintoDatabase;
  carica: Carica;
  rimborsi: Array<{ amount: number; chiave: string }>;
  suStripe: RimborsoSuStripe[];
  /** Quante risposte di Stripe si perdono per strada dopo aver fatto il rimborso. */
  rispostePerse: number;
  storni: Array<{ transferId: string; amount: number; chiave: string }>;
  bonifici: Array<{ amount: number; destination: string }>;
} = {
  db: fintoDatabase(), carica: { amount: 2790, refunded: 0 }, rimborsi: [], suStripe: [], rispostePerse: 0, storni: [], bonifici: [],
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      // Stripe vero: un rimborso più grande di quanto resta sul pagamento si rifiuta.
      create: async (p: { amount: number; metadata?: Record<string, string> }, o: { idempotencyKey: string }) => {
        // Stripe vero: la stessa chiave anti-doppione restituisce lo STESSO rimborso.
        const gia = stato.suStripe.find((r) => r.chiave === o.idempotencyKey);
        if (gia) return { id: gia.id, status: gia.status };
        const resta = stato.carica.amount - stato.carica.refunded;
        if (p.amount > resta) {
          throw new Error(`Refund amount (${p.amount}) is greater than unrefunded amount on charge (${resta})`);
        }
        stato.carica.refunded += p.amount;
        stato.rimborsi.push({ amount: p.amount, chiave: o.idempotencyKey });
        const nuovo = { id: `re_${stato.suStripe.length + 1}`, amount: p.amount, status: 'succeeded', metadata: p.metadata ?? {}, chiave: o.idempotencyKey };
        stato.suStripe.push(nuovo);
        // Il rimborso c'è, ma la risposta non arriva: la rete è caduta dopo.
        if (stato.rispostePerse > 0) {
          stato.rispostePerse -= 1;
          throw new Error('socket hang up');
        }
        return { id: nuovo.id, status: nuovo.status };
      },
      // Dalla versione 2022-11-15 delle API i rimborsi non arrivano dentro l'avviso: si chiedono.
      list: async () => ({ data: stato.suStripe.map((r) => ({ ...r })), has_more: false }),
    },
    transfers: {
      createReversal: async (transferId: string, p: { amount: number }, o: { idempotencyKey: string }) => {
        if (!stato.storni.some((s) => s.chiave === o.idempotencyKey)) {
          stato.storni.push({ transferId, amount: p.amount, chiave: o.idempotencyKey });
        }
        return { id: `trr_${o.idempotencyKey}` };
      },
      list: async () => ({ data: [] }),
      create: async (p: { amount: number; destination: string }) => {
        stato.bonifici.push({ amount: p.amount, destination: p.destination });
        return { id: `tr_${stato.bonifici.length}` };
      },
    },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';
import { contoDelRimborsoDaFuori, PAUSA_RIMBORSO_DA_DIVIDERE, sommaDeiRimborsiDaFuori } from '@/lib/stripe/webhook/rimborsi-da-fuori';
import { releaseOrderPayout, refundOrder } from '@/lib/stripe/payout';
import { annullaERimborsa, type OrdineDaAnnullare } from '@/lib/ordini/annulla';

/** L'ordine della scheda: 27,90 € con carta, al negozio spettano 18,00 € (90% di 20 €). */
function ordineDiPaneQuotidiano(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    user_id: 'cliente1',
    seller_id: 'pane-quotidiano',
    total_price: 27.9,
    gross_total_cents: 2790,
    refunded_amount_cents: 0,
    payment_method: 'card',
    payment_status: 'PAID',
    delivery_status: 'DELIVERED',
    payout_status: 'HELD',
    payout_tentativo: 0,
    seller_payout_cents: 1800,
    seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_session_id: 'cs_1',
    stripe_transfer_group: 'mc_1',
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

/** L'avviso che Stripe manda dopo un rimborso dal cruscotto: nessuna etichetta d'ordine. */
function avvisoDiRimborso(rimborsatoInTutto: number, totale = 2790) {
  return {
    id: 'ch_1',
    payment_intent: 'pi_1',
    refunded: false,
    amount: totale,
    amount_refunded: rimborsatoInTutto,
  } as unknown as Parameters<typeof handleChargeRefunded>[0];
}

/** Un rimborso fatto a mano dal cruscotto: nessuna etichetta d'ordine. */
function ilCruscottoRimborsa(centesimi: number): void {
  stato.carica.refunded += centesimi;
  stato.suStripe.push({ id: `re_cruscotto_${stato.suStripe.length + 1}`, amount: centesimi, status: 'succeeded', metadata: {}, chiave: null });
}

/** Il rimborso dal cruscotto: i soldi escono da Stripe, poi arriva l'avviso. */
async function rimborsoDalCruscotto(centesimi: number): Promise<void> {
  ilCruscottoRimborsa(centesimi);
  await handleChargeRefunded(avvisoDiRimborso(stato.carica.refunded, stato.carica.amount));
}

const ordine = (id = 'o1') => stato.db.tabelle.orders!.find((r) => r.id === id)!;

beforeEach(() => {
  stato.carica = { amount: 2790, refunded: 0 };
  stato.rimborsi = [];
  stato.suStripe = [];
  stato.rispostePerse = 0;
  stato.storni = [];
  stato.bonifici = [];
  stato.db = fintoDatabase({
    orders: [],
    profiles: [
      { id: 'admin1', role: 'admin' },
      { id: 'pane-quotidiano', role: 'seller', stripe_account_id: 'acct_pq', stripe_payouts_enabled: true },
    ],
    notifications: [],
  });
  // La somma che fa il database (`accumula_rimborso`): aggiunge, col tetto del lordo.
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

describe('rimborso parziale dal cruscotto su un ordine solo', () => {
  it('IL CASO DELLA SCHEDA — la focaccia da 3 € scende dal bonifico al negozio', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano()];

    await rimborsoDalCruscotto(300);
    const esito = await releaseOrderPayout('o1');

    expect(esito.ok).toBe(true);
    // 300 × 1800 ÷ 2790 = 193,5 → 194 centesimi a carico del negozio, come in refundOrder.
    expect(
      stato.bonifici[0]?.amount,
      'il negozio ha preso il netto intero: la sua parte del rimborso l ha pagata MyCity',
    ).toBe(1800 - 194);
    expect(ordine()).toMatchObject({ refunded_amount_cents: 300, payment_status: 'PARTIALLY_REFUNDED' });
  });

  it('LA VARIANTE DELLA SCHEDA — l annullo dopo chiede a Stripe solo quello che resta, e riesce', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano({ delivery_status: 'ACCEPTED' })];
    await rimborsoDalCruscotto(300);

    const esito = await annullaERimborsa(stato.db.client as never, { ...ordine() } as unknown as OrdineDaAnnullare, {
      reason: 'annullato dal negozio',
    });

    expect(esito, 'Stripe ha rifiutato il rimborso: l ordine resta pagato e non annullabile dal sito').toMatchObject({ ok: true });
    expect(stato.rimborsi.map((r) => r.amount)).toEqual([2490]);
    expect(stato.carica.refunded).toBe(2790);
    expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', refunded_amount_cents: 2790 });
  });

  it('bonifico già partito: la quota del negozio si riprende con uno storno', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_pq' })];

    await rimborsoDalCruscotto(300);

    expect(stato.storni).toEqual([expect.objectContaining({ transferId: 'tr_pq', amount: 194 })]);
    expect(ordine()).toMatchObject({ refunded_amount_cents: 300, seller_payout_reversed_cents: 194, payment_status: 'PARTIALLY_REFUNDED' });
  });

  it('due rimborsi dal cruscotto uno dopo l altro si sommano, senza contare due volte il primo', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano()];

    await rimborsoDalCruscotto(300);
    await rimborsoDalCruscotto(500);
    await releaseOrderPayout('o1');

    // 194 per i primi 3 €, poi 500 × 1800 ÷ 2790 = 322,6 → 323 per gli altri 5 €.
    expect(ordine()).toMatchObject({ refunded_amount_cents: 800, seller_payout_reversed_cents: 194 + 323 });
    expect(stato.bonifici[0]?.amount).toBe(1800 - 194 - 323);
  });

  it('lo stesso avviso consegnato due volte si registra una volta sola', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano()];
    ilCruscottoRimborsa(300);

    await handleChargeRefunded(avvisoDiRimborso(300));
    await handleChargeRefunded(avvisoDiRimborso(300));

    expect(ordine()).toMatchObject({ refunded_amount_cents: 300, seller_payout_reversed_cents: 194 });
  });

  it('l eco di un rimborso NOSTRO non tocca niente: era già scritto da refundOrder', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano()];
    await refundOrder({ orderId: 'o1', amountCents: 500, reason: 'reso' });
    const dopoIlNostro = { ...ordine() };

    // Stripe avvisa del rimborso appena fatto da noi.
    await handleChargeRefunded(avvisoDiRimborso(stato.carica.refunded));

    expect(ordine().refunded_amount_cents, 'rimborso contato due volte').toBe(500);
    expect(ordine().seller_payout_reversed_cents).toBe(dopoIlNostro.seller_payout_reversed_cents);
  });

  it('se nel frattempo un altro rimborso ha cambiato l ordine, non somma alla cieca: Stripe riprova', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano()];
    ilCruscottoRimborsa(300);
    // Fra la lettura e la scrittura, un reso interno da 200 € registra il suo importo.
    let unaVolta = true;
    stato.db.guasto = (s) => {
      if (unaVolta && s.tabella === 'orders' && s.operazione === 'update') {
        unaVolta = false;
        ordine().refunded_amount_cents = 200;
      }
      return null;
    };

    await expect(handleChargeRefunded(avvisoDiRimborso(300))).rejects.toThrow();
    expect(ordine().refunded_amount_cents, 'scritto sopra un importo che nel frattempo era cambiato').toBe(200);
  });

  it('se il giro dei bonifici sta pagando proprio ora, si aspetta che finisca', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano({ payout_status: 'PROCESSING' })];
    ilCruscottoRimborsa(300);
    await expect(handleChargeRefunded(avvisoDiRimborso(300))).rejects.toThrow();
    expect(ordine().refunded_amount_cents).toBe(0);
  });
});

describe('rimborso parziale dal cruscotto su un pagamento di più negozi', () => {
  it('Stripe non dice di quale negozio è: i bonifici del carrello si fermano e gli amministratori lo sanno', async () => {
    stato.db.tabelle.orders = [
      ordineDiPaneQuotidiano({ id: 'o1', total_price: 15, gross_total_cents: 1500 }),
      ordineDiPaneQuotidiano({ id: 'o2', seller_id: 'altro', total_price: 12.9, gross_total_cents: 1290 }),
    ];

    await rimborsoDalCruscotto(300);

    expect(ordine('o1').internal_dispute_status).toBe(PAUSA_RIMBORSO_DA_DIVIDERE);
    expect(ordine('o2').internal_dispute_status).toBe(PAUSA_RIMBORSO_DA_DIVIDERE);
    // Lo stesso filtro con cui il giro dei bonifici sceglie chi pagare
    // (app/api/cron/release-payouts): gli ordini fermati non ci sono più.
    const { data: pagabili } = (await stato.db.client
      .from('orders')
      .select('id')
      .or('internal_dispute_status.is.null,internal_dispute_status.eq.RESOLVED')) as { data: Riga[] };
    expect(pagabili, 'il giro dei bonifici pagherebbe ancora il netto intero').toHaveLength(0);
    // Nessun negozio scelto a caso.
    expect(ordine('o1').refunded_amount_cents).toBe(0);
    expect(ordine('o2').refunded_amount_cents).toBe(0);
    const avvisi = stato.db.tabelle.notifications!.filter((n) => n.user_id === 'admin1');
    expect(avvisi.length, 'nessun amministratore avvisato del rimborso da dividere').toBeGreaterThan(0);
  });

  it('un reclamo interno già aperto su un ordine del carrello non viene sovrascritto', async () => {
    stato.db.tabelle.orders = [
      ordineDiPaneQuotidiano({ id: 'o1', gross_total_cents: 1500, internal_dispute_status: 'OPEN' }),
      ordineDiPaneQuotidiano({ id: 'o2', seller_id: 'altro', gross_total_cents: 1290 }),
    ];
    await rimborsoDalCruscotto(300);
    expect(ordine('o1').internal_dispute_status).toBe('OPEN');
    expect(ordine('o2').internal_dispute_status).toBe(PAUSA_RIMBORSO_DA_DIVIDERE);
  });

  it('l eco dei nostri rimborsi, già scritti ordine per ordine, non ferma niente', async () => {
    stato.db.tabelle.orders = [
      ordineDiPaneQuotidiano({ id: 'o1', gross_total_cents: 1500, refunded_amount_cents: 200 }),
      ordineDiPaneQuotidiano({ id: 'o2', seller_id: 'altro', gross_total_cents: 1290, refunded_amount_cents: 100 }),
    ];
    stato.carica.refunded = 300;
    await handleChargeRefunded(avvisoDiRimborso(300));
    expect(ordine('o1').internal_dispute_status).toBeNull();
    expect(ordine('o2').internal_dispute_status).toBeNull();
  });
});

describe('un rimborso NOSTRO la cui risposta si è persa non diventa «da fuori» (collaudo del 15/10)', () => {
  it('IL CASO DEL COLLAUDO — refundOrder perde la risposta, poi riprova: 3 € rimborsati e 1,94 € al negozio, non il doppio', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano()];
    // Il rimborso nasce su Stripe, ma la risposta cade: refundOrder toglie il
    // suo segno dall'ordine per poter riprovare (`storna_rimborso`).
    stato.rispostePerse = 1;
    await expect(refundOrder({ orderId: 'o1', amountCents: 300, reason: 'reso', idempotencyKey: 'return_r1' })).rejects.toThrow();
    expect(ordine().refunded_amount_cents).toBe(0);

    // Arriva l'avviso di Stripe: il rimborso porta l'etichetta dell'ordine.
    await handleChargeRefunded(avvisoDiRimborso(stato.carica.refunded));
    expect(ordine().refunded_amount_cents, 'il rimborso nostro registrato come se venisse dal cruscotto').toBe(0);

    // Il reso si ridecide: stessa chiave, Stripe restituisce lo stesso rimborso.
    await refundOrder({ orderId: 'o1', amountCents: 300, reason: 'reso', idempotencyKey: 'return_r1' });

    expect(stato.rimborsi.map((r) => r.amount), 'un secondo rimborso su Stripe').toEqual([300]);
    expect(ordine(), 'rimborsato e quota del negozio contati due volte').toMatchObject({
      refunded_amount_cents: 300, seller_payout_reversed_cents: 194, payment_status: 'PARTIALLY_REFUNDED',
    });
  });

  it('un rimborso dal cruscotto accanto a uno nostro già scritto: si registra solo quello del cruscotto', async () => {
    stato.db.tabelle.orders = [ordineDiPaneQuotidiano()];
    await refundOrder({ orderId: 'o1', amountCents: 500, reason: 'reso' });
    await rimborsoDalCruscotto(300);

    expect(ordine()).toMatchObject({ refunded_amount_cents: 800 });
  });
});

describe('il carrello di più negozi, dopo la divisione fatta a mano', () => {
  it('scritta la parte su ciascun ordine e tolta la pausa, l eco di un reso successivo non ferma di nuovo i bonifici', async () => {
    stato.db.tabelle.orders = [
      ordineDiPaneQuotidiano({ id: 'o1', total_price: 15, gross_total_cents: 1500, seller_payout_cents: 1000 }),
      ordineDiPaneQuotidiano({ id: 'o2', seller_id: 'altro', total_price: 12.9, gross_total_cents: 1290, seller_payout_cents: 900 }),
    ];
    await rimborsoDalCruscotto(300);
    expect(ordine('o2').internal_dispute_status).toBe(PAUSA_RIMBORSO_DA_DIVIDERE);
    const avvisiPrima = stato.db.tabelle.notifications!.length;

    // La divisione a mano, come nelle istruzioni: i 3 € erano dell'ordine o2.
    Object.assign(ordine('o2'), {
      refunded_amount_cents: 300, payment_status: 'PARTIALLY_REFUNDED',
      seller_payout_reversed_cents: Math.round((300 * 900) / 1290), internal_dispute_status: 'RESOLVED',
    });
    Object.assign(ordine('o1'), { internal_dispute_status: 'RESOLVED' });

    // Poi un reso fatto dal sito sull'ordine o1, e la sua eco.
    await refundOrder({ orderId: 'o1', amountCents: 500, reason: 'reso' });
    await handleChargeRefunded(avvisoDiRimborso(stato.carica.refunded));

    expect(ordine('o1').internal_dispute_status, 'bonifici fermati di nuovo').toBe('RESOLVED');
    expect(ordine('o2').internal_dispute_status).toBe('RESOLVED');
    expect(stato.db.tabelle.notifications!.slice(avvisiPrima).filter((n) => String(n.title).includes('da dividere'))).toEqual([]);
  });
});

describe('il conto, da solo', () => {
  it('non conta come «da fuori» più dei rimborsi senza etichetta d ordine', () => {
    const c = contoDelRimborsoDaFuori({ total_price: 27.9, refunded_amount_cents: 0, seller_payout_cents: 1800 }, 300, 0);
    expect(c.nuovoCents).toBe(0);
    expect(contoDelRimborsoDaFuori({ total_price: 27.9, refunded_amount_cents: 0, seller_payout_cents: 1800 }, 800, 300).nuovoCents).toBe(300);
  });

  it('somma solo i rimborsi senza etichetta e non falliti', () => {
    expect(
      sommaDeiRimborsiDaFuori([
        { amount: 300, status: 'succeeded', metadata: {} },
        { amount: 500, status: 'succeeded', metadata: { order_id: 'o1' } },
        { amount: 200, status: 'failed', metadata: {} },
        { amount: 100, status: 'pending', metadata: null },
      ]),
    ).toBe(400);
  });

  it('toglie al negozio la sua parte del netto, in proporzione al rimborso', () => {
    expect(
      contoDelRimborsoDaFuori({ total_price: 27.9, refunded_amount_cents: 0, seller_payout_cents: 1800 }, 300),
    ).toEqual({ lordoCents: 2790, giaRegistratoCents: 0, nuovoCents: 300, totaleCents: 300, quotaNegozioCents: 194 });
  });

  it('conta solo la parte non ancora registrata, e mai oltre il lordo', () => {
    const c = contoDelRimborsoDaFuori(
      { total_price: 27.9, refunded_amount_cents: 2500, seller_payout_cents: 1800 },
      9999,
    );
    expect(c.nuovoCents).toBe(290);
    expect(c.totaleCents).toBe(2790);
  });

  it('un rimborso già tutto registrato vale zero', () => {
    expect(
      contoDelRimborsoDaFuori({ total_price: 27.9, refunded_amount_cents: 300, seller_payout_cents: 1800 }, 300).nuovoCents,
    ).toBe(0);
  });
});
