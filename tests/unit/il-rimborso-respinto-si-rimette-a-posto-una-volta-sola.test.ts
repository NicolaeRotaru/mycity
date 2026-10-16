import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 (riesame del lotto) — LO STESSO RIMBORSO RESPINTO LAVORATO DUE VOLTE.
 *
 * Quando la banca del cliente respinge un rimborso, il gestore toglie
 * dall'ordine l'importo tornato indietro e rimette la quota del negozio nel suo
 * bonifico. Non lasciava nessun segno di averlo fatto, e scriveva senza
 * guardare se l'ordine era ancora quello letto. Se l'avviso passava una
 * seconda volta, rifaceva tutto sul valore già ridotto.
 *
 * Il caso misurato dal revisore sulla rotta vera: ordine da 40 € col bonifico
 * al negozio ancora trattenuto, due rimborsi parziali da 10 € (arrivato) e da
 * 5 € (respinto). Il segno «lavorato» sull'avviso non si scrive, la rotta
 * risponde 200, e Stripe consegna di nuovo dopo più di cinque minuti. Primo
 * passaggio: rimborsato da 15 € a 10 €. Secondo: a 5 €, e al negozio la quota
 * dei 5 € tornava una seconda volta nel bonifico (4,05 € in più).
 *
 * Qui girano la rotta VERA e il gestore VERO, su un database finto che
 * applica i filtri come PostgREST.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const stato: {
  db: FintoDatabase;
  evento: { id: string; type: string; data: { object: Record<string, unknown> } };
} = { db: fintoDatabase(), evento: { id: 'evt_x', type: 'noop', data: { object: {} } } };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ contaAcquisto: vi.fn(async () => {}), analyticsConsentita: vi.fn(async () => false) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    refunds: { list: async () => ({ data: [], has_more: false }) },
  }),
  isStripeConfigured: () => true,
}));

import { POST } from '@/app/api/stripe/webhook/route';
import {
  pianoDelRimborsoRespinto,
  quotaGiaTolta,
  segnoDelRimborsoRespinto,
} from '@/lib/stripe/rimborso-respinto';

async function consegna(): Promise<number> {
  const r = await POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      body: '{}',
    }) as never,
  );
  return r.status;
}

/** Il rimborso che la banca ha respinto. Con `perOrdine` porta l'etichetta di `refundOrder`. */
function avvisoRespinto(eventoId: string, refundId: string, centesimi: number, perOrdine: string | null = 'o1') {
  stato.evento = {
    id: eventoId,
    type: 'charge.refund.updated',
    data: {
      object: {
        id: refundId, status: 'failed', amount: centesimi, payment_intent: 'pi_1',
        metadata: perOrdine ? { order_id: perOrdine } : {},
      },
    },
  };
}

/**
 * Ordine da 40 €, 32,40 € al negozio, col bonifico ancora trattenuto. Due
 * rimborsi parziali: 10 € e 5 €. La quota del negozio è già tolta sulla carta:
 * 8,10 € + 4,05 € = 12,15 €.
 */
function ordineConDueRimborsi(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    total_price: 40,
    gross_total_cents: 4000,
    refunded_amount_cents: 1500,
    payment_status: 'PARTIALLY_REFUNDED',
    payout_status: 'HELD',
    stripe_payment_intent: 'pi_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    seller_payout_cents: 3240,
    seller_payout_reversed_cents: 1215,
    payout_tentativo: 0,
    stripe_refund_id: 're_1,re_2',
    ...extra,
  };
}

const ordine = (id = 'o1') => stato.db.tabelle.orders!.find((r) => r.id === id)!;
const registro = () => stato.db.tabelle.stripe_event_log?.find((r) => r.event_id === stato.evento.id);
const avvisiAgliAmministratori = () =>
  stato.db.tabelle.notifications!.filter((n) => n.title === '⚠️ Rimborso rifiutato dalla banca');
/** Il segno «lavorato» sull'avviso va in timeout: la rotta risponde 200 lo stesso. */
const segnoLavoratoCade = (s: { tabella: string; valori: unknown }) =>
  s.tabella === 'stripe_event_log' && (s.valori as Riga | null)?.processed === true ? TIMEOUT : null;
/** Stripe consegna di nuovo lo stesso avviso, dopo che il turno di cinque minuti è scaduto. */
async function stripeLoRimandaDopo(): Promise<number> {
  const r = registro();
  if (r) r.claimed_at = '2000-01-01T00:00:00.000Z';
  return consegna();
}

beforeEach(() => {
  stato.db = fintoDatabase({
    orders: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
    stripe_event_log: [],
  });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
});

describe('lo stesso rimborso respinto, passato due volte dalla rotta', () => {
  it('IL CASO DEL RIESAME — bonifico trattenuto: dopo il secondo passaggio l ordine è com era dopo il primo', async () => {
    stato.db.tabelle.orders = [ordineConDueRimborsi()];
    avvisoRespinto('evt_respinto', 're_2', 500);
    stato.db.guasto = segnoLavoratoCade;
    expect(await consegna()).toBe(200);
    expect(ordine()).toMatchObject({ refunded_amount_cents: 1000, seller_payout_reversed_cents: 810 });

    stato.db.guasto = () => null;
    expect(await stripeLoRimandaDopo()).toBe(200);

    expect(ordine().refunded_amount_cents, 'il cliente i 10 € li ha avuti davvero: non si tolgono').toBe(1000);
    expect(ordine().seller_payout_reversed_cents, 'al negozio la quota dei 5 € tornava due volte (4,05 € in più)').toBe(810);
    expect(ordine()).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED', payout_status: 'HELD' });
    expect(avvisiAgliAmministratori(), 'due avvisi = il cliente rimborsato due volte a mano').toHaveLength(1);
  });

  it('bonifico già uscito (REVERSED): il secondo passaggio non lo riapre e non alza il tentativo', async () => {
    stato.db.tabelle.orders = [ordineConDueRimborsi({ payout_status: 'REVERSED', stripe_transfer_id: 'tr_1', stripe_reversal_id: 'trr_1' })];
    avvisoRespinto('evt_respinto', 're_2', 500);
    stato.db.guasto = segnoLavoratoCade;
    expect(await consegna()).toBe(200);
    expect(ordine()).toMatchObject({ payout_status: 'HELD', payout_tentativo: 1, seller_payout_reversed_cents: 810 });

    stato.db.guasto = () => null;
    expect(await stripeLoRimandaDopo()).toBe(200);
    expect(ordine()).toMatchObject({
      refunded_amount_cents: 1000, seller_payout_reversed_cents: 810, payout_status: 'HELD', payout_tentativo: 1,
    });
  });

  it('un secondo avviso (altro id) per lo stesso rimborso già respinto non tocca niente', async () => {
    stato.db.tabelle.orders = [ordineConDueRimborsi()];
    avvisoRespinto('evt_respinto', 're_2', 500);
    expect(await consegna()).toBe(200);

    // Stripe manda un altro charge.refund.updated per lo stesso rimborso (per
    // esempio quando cambia l'etichetta): il registro degli avvisi non lo
    // ferma, perché l'id dell'avviso è nuovo.
    avvisoRespinto('evt_respinto_bis', 're_2', 500);
    expect(await consegna()).toBe(200);

    expect(ordine()).toMatchObject({ refunded_amount_cents: 1000, seller_payout_reversed_cents: 810 });
    expect(avvisiAgliAmministratori()).toHaveLength(1);
  });

  it('un altro rimborso scritto fra la lettura e la scrittura non si perde: si riprova sui numeri nuovi', async () => {
    stato.db.tabelle.orders = [ordineConDueRimborsi()];
    avvisoRespinto('evt_respinto', 're_2', 500);
    // Mentre il gestore lavora, `refundOrder` registra un terzo reso da 3 €
    // (`accumula_rimborso`): il rimborsato passa da 15 € a 18 €.
    let giaCambiato = false;
    stato.db.guasto = (s) => {
      if (!giaCambiato && s.tabella === 'orders' && s.operazione === 'update') {
        giaCambiato = true;
        Object.assign(ordine(), { refunded_amount_cents: 1800, seller_payout_reversed_cents: 1458, stripe_refund_id: 're_1,re_2,re_3' });
      }
      return null;
    };

    expect(await consegna(), 'scrivere sui numeri vecchi cancellerebbe il reso da 3 €').toBe(500);
    expect(await consegna(), 'Stripe riprova e la seconda volta passa').toBe(200);

    expect(ordine().refunded_amount_cents, 'scritto sui numeri letti prima: 10 €, e i 3 € spariti').toBe(1300);
    expect(ordine().seller_payout_reversed_cents).toBe(1053);
    expect(avvisiAgliAmministratori()).toHaveLength(1);
  });

  it('carrello di due negozi, rimborso dal cruscotto: se si ferma a metà, il secondo passaggio divide solo il resto', async () => {
    // Due ordini sullo stesso pagamento: 6 € rimborsati sul primo, 14 € sul
    // secondo. La banca respinge un rimborso da 10 € senza etichetta: si divide
    // in proporzione, 3 € al primo e 7 € al secondo.
    stato.db.tabelle.orders = [
      ordineConDueRimborsi({ id: 'a', refunded_amount_cents: 600, seller_payout_reversed_cents: 486, stripe_refund_id: null }),
      ordineConDueRimborsi({ id: 'b', refunded_amount_cents: 1400, seller_payout_reversed_cents: 1134, stripe_refund_id: null }),
    ];
    avvisoRespinto('evt_respinto', 're_9', 1000, null);
    // La scrittura sul secondo ordine va in timeout, una volta.
    let caduta = false;
    stato.db.guasto = (s) => {
      if (!caduta && s.tabella === 'orders' && String((s.valori as Riga | null)?.stripe_refund_id ?? '').includes(':re_9') &&
        (s.valori as Riga).refunded_amount_cents === 700) {
        caduta = true;
        return TIMEOUT;
      }
      return null;
    };

    expect(await consegna(), 'il database ha detto di no: Stripe deve riprovare').toBe(500);
    expect(ordine('a').refunded_amount_cents).toBe(300);
    expect(await consegna()).toBe(200);

    expect(ordine('a').refunded_amount_cents, 'il primo ordine non si ritocca').toBe(300);
    expect(ordine('b').refunded_amount_cents, 'al secondo vanno 7 €, non di nuovo tutti i 10').toBe(700);
    expect(avvisiAgliAmministratori()).toHaveLength(1);
  });
});

describe('il segno del rimborso respinto', () => {
  it('dice quale rimborso e quanto, e non si confonde con un id che comincia uguale', () => {
    const segno = segnoDelRimborsoRespinto('re_2', 500);
    expect(segno).toBe('respinto:500:re_2');
    expect(quotaGiaTolta({ stripe_refund_id: `re_1,${segno}` }, 're_2')).toBe(500);
    expect(quotaGiaTolta({ stripe_refund_id: `re_1,${segno}` }, 're_20')).toBeNull();
    expect(quotaGiaTolta({ stripe_refund_id: 'respinto:500:re_20' }, 're_2')).toBeNull();
    expect(quotaGiaTolta({ stripe_refund_id: 're_2' }, 're_2'), 'l id da solo è il rimborso scritto, non quello respinto').toBeNull();
    expect(quotaGiaTolta({ stripe_refund_id: segno }, ''), 'senza id non si riconosce niente').toBeNull();
  });

  it('si aggiunge all elenco senza togliere quello che c era', () => {
    const { scritture } = pianoDelRimborsoRespinto(
      [{ id: 'o1', refunded_amount_cents: 1500, payment_status: 'PARTIALLY_REFUNDED', stripe_refund_id: 're_1,bonifico:300:return_x' }],
      're_2',
      500,
    );
    expect(scritture[0].valori.stripe_refund_id).toBe('re_1,bonifico:300:return_x,respinto:500:re_2');
    expect(scritture[0].seAncora).toEqual({ refunded_amount_cents: 1500, payout_status: null, stripe_refund_id: 're_1,bonifico:300:return_x' });
  });

  it('un ordine che porta già il segno resta fuori dal piano', () => {
    const piano = pianoDelRimborsoRespinto(
      [{ id: 'o1', refunded_amount_cents: 1000, payment_status: 'PARTIALLY_REFUNDED', stripe_refund_id: 're_1,respinto:500:re_2' }],
      're_2',
      500,
    );
    expect(piano).toEqual({ scritture: [], giaFatti: ['o1'] });
  });

  it('senza id del rimborso si comporta come prima: niente segno, niente da saltare', () => {
    const { scritture } = pianoDelRimborsoRespinto(
      [{ id: 'o1', refunded_amount_cents: 1500, payment_status: 'PARTIALLY_REFUNDED', stripe_refund_id: null }],
      '',
      500,
    );
    expect(scritture[0].valori).not.toHaveProperty('stripe_refund_id');
    expect(scritture[0].valori.refunded_amount_cents).toBe(1000);
  });
});
