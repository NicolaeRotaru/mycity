import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 — I BONIFICI FERMATI DA UN RIMBORSO DAL CRUSCOTTO NON SI POTEVANO
 * SBLOCCARE DAL PANNELLO.
 *
 * Su un carrello di più negozi Stripe non dice di quale negozio è un rimborso
 * fatto dal cruscotto: il webhook ferma i bonifici di tutto il carrello e chiede
 * di dividerlo a mano. Nessuna pagina e nessuna rotta lo sapeva fare. Un caso:
 * carrello da Pane Quotidiano (15,00 €) e da un fioraio (12,90 €, bonifico già
 * partito); Nicola rimborsa 3 € di fiori dal cruscotto; tutti e due i bonifici
 * si fermano e si sbloccano solo scrivendo nel database.
 *
 * La prova fa girare il gestore VERO del webhook, la rotta VERA del pannello e
 * lo storno VERO, contro un database finto e uno Stripe finto.
 */

type RimborsoSuStripe = { id: string; amount: number; status: string; metadata: Record<string, string>; created: number };
const stato: {
  db: FintoDatabase;
  carica: { amount: number; refunded: number };
  suStripe: RimborsoSuStripe[];
  storni: Array<{ transferId: string; amount: number; chiave: string }>;
  /** Quante risposte di Stripe si perdono per strada dopo aver fatto il rimborso. */
  rispostePerse: number;
  /** Se falso, Stripe non risponde quando gli si chiede di etichettare un rimborso. */
  etichetteRiescono: boolean;
  /** I pagamenti di cui Stripe, adesso, non lascia leggere i rimborsi. */
  pagamentiIlleggibili: Set<string>;
} = {
  db: fintoDatabase(), carica: { amount: 2790, refunded: 0 }, suStripe: [], storni: [],
  rispostePerse: 0, etichetteRiescono: true, pagamentiIlleggibili: new Set(),
};
let orologio = 1_800_000_000;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (ctx: unknown) => unknown) => (req: unknown) =>
    h({ req, user: { id: 'admin1' }, profile: { role: 'admin' }, params: {} }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: async (p: { amount: number; metadata?: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = stato.suStripe.find((r) => r.metadata.chiave === o.idempotencyKey);
        if (gia) return { id: gia.id, status: gia.status };
        stato.carica.refunded += p.amount;
        const nuovo = { id: `re_${stato.suStripe.length + 1}`, amount: p.amount, status: 'succeeded', metadata: { ...(p.metadata ?? {}), chiave: o.idempotencyKey }, created: ++orologio };
        stato.suStripe.push(nuovo);
        // Il rimborso c'è, ma la risposta non arriva: la rete è caduta dopo.
        if (stato.rispostePerse > 0) {
          stato.rispostePerse -= 1;
          throw new Error('socket hang up');
        }
        return { id: nuovo.id, status: nuovo.status };
      },
      list: async (p: { payment_intent?: string; charge?: string }) => {
        if (p.payment_intent && stato.pagamentiIlleggibili.has(p.payment_intent)) throw new Error('Too many requests');
        return { data: [...stato.suStripe].reverse().map((r) => ({ ...r, metadata: { ...r.metadata } })), has_more: false };
      },
      update: async (id: string, p: { metadata?: Record<string, string> }) => {
        if (!stato.etichetteRiescono) throw new Error('Stripe non risponde');
        const r = stato.suStripe.find((x) => x.id === id);
        if (!r) throw new Error(`No such refund: ${id}`);
        r.metadata = { ...r.metadata, ...(p.metadata ?? {}) };
        return { ...r };
      },
    },
    transfers: {
      createReversal: async (transferId: string, p: { amount: number }, o: { idempotencyKey: string }) => {
        if (!stato.storni.some((s) => s.chiave === o.idempotencyKey)) stato.storni.push({ transferId, amount: p.amount, chiave: o.idempotencyKey });
        return { id: `trr_${o.idempotencyKey}` };
      },
      list: async () => ({ data: [] }),
    },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';
import { refundOrder } from '@/lib/stripe/payout';
import { GET, POST } from '@/app/api/admin/orders/rimborsi-da-dividere/route';
import { centesimiDaEuro, controllaLaDivisione } from '@/lib/rimborsi/divisione-del-rimborso';

function ordine(extra: Riga): Riga {
  return {
    user_id: 'cliente1',
    payment_method: 'card',
    payment_status: 'PAID',
    delivery_status: 'DELIVERED',
    refunded_amount_cents: 0,
    payout_status: 'HELD',
    payout_tentativo: 0,
    seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
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
    shipping_cost: 0,
    ...extra,
  };
}

const riga = (id: string) => stato.db.tabelle.orders!.find((r) => r.id === id)!;

async function rimborsoDalCruscotto(centesimi: number): Promise<void> {
  stato.carica.refunded += centesimi;
  stato.suStripe.push({ id: `re_cruscotto_${stato.suStripe.length + 1}`, amount: centesimi, status: 'succeeded', metadata: {}, created: ++orologio });
  await handleChargeRefunded({
    id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: stato.carica.amount, amount_refunded: stato.carica.refunded,
  } as unknown as Parameters<typeof handleChargeRefunded>[0]);
}

async function dividi(parti: Array<{ ordine: string; centesimi: number }>): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x/api/admin/orders/rimborsi-da-dividere', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pagamento: 'pi_1', parti }),
    }),
  );
  return { status: res.status, corpo: await res.json() };
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
  stato.carica = { amount: 2790, refunded: 0 };
  stato.suStripe = [];
  stato.storni = [];
  stato.rispostePerse = 0;
  stato.etichetteRiescono = true;
  stato.pagamentiIlleggibili = new Set();
  stato.db = fintoDatabase({
    orders: [
      ordine({ id: 'o1', seller_id: 'pane-quotidiano', total_price: 15, gross_total_cents: 1500, seller_payout_cents: 1000 }),
      ordine({
        id: 'o2', seller_id: 'fioraio', total_price: 12.9, gross_total_cents: 1290, seller_payout_cents: 900,
        payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_o2',
      }),
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

describe('il rimborso dal cruscotto su un carrello di più negozi si divide dal pannello', () => {
  it('IL CASO DELLA SCHEDA — i 3 € erano dei fiori: il fioraio perde la sua quota con uno storno, e i due bonifici ripartono', async () => {
    await rimborsoDalCruscotto(300);
    expect(await pagabili(), 'il webhook non ha fermato i bonifici').toEqual([]);

    const { status } = await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);

    expect(status).toBe(200);
    expect(await pagabili(), 'i bonifici restano fermi: si sbloccano solo scrivendo nel database').toEqual(['o1', 'o2']);
    expect(riga('o2')).toMatchObject({ refunded_amount_cents: 300, payment_status: 'PARTIALLY_REFUNDED' });
    // 300 × 900 ÷ 1290 = 209,3 → 209 centesimi a carico del fioraio, ripresi con uno storno.
    expect(stato.storni).toEqual([expect.objectContaining({ transferId: 'tr_o2', amount: 209 })]);
    expect(riga('o2').seller_payout_reversed_cents).toBe(209);
    expect(riga('o1')).toMatchObject({ refunded_amount_cents: 0, seller_payout_reversed_cents: 0, payment_status: 'PAID' });
    expect(stato.suStripe[0].metadata).toMatchObject({ registrato_da_fuori: '1' });
  });

  it('la parte di un ordine col bonifico ancora da fare scende dal bonifico', async () => {
    await rimborsoDalCruscotto(300);
    await dividi([{ ordine: 'o1', centesimi: 300 }, { ordine: 'o2', centesimi: 0 }]);
    // 300 × 1000 ÷ 1500 = 200.
    expect(riga('o1')).toMatchObject({ refunded_amount_cents: 300, seller_payout_reversed_cents: 200, internal_dispute_status: null });
    expect(stato.storni).toEqual([]);
  });

  it('dopo la divisione, l eco di un reso fatto dal sito non ferma di nuovo i bonifici', async () => {
    await rimborsoDalCruscotto(300);
    await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);
    const avvisiPrima = stato.db.tabelle.notifications!.length;

    await refundOrder({ orderId: 'o1', amountCents: 500, reason: 'reso' });
    await handleChargeRefunded({
      id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: 2790, amount_refunded: stato.carica.refunded,
    } as unknown as Parameters<typeof handleChargeRefunded>[0]);

    expect(await pagabili()).toEqual(['o1', 'o2']);
    expect(stato.db.tabelle.notifications!.slice(avvisiPrima).filter((n) => String(n.title).includes('da dividere'))).toEqual([]);
  });

  it('una divisione che non fa il totale non registra niente e lo dice', async () => {
    await rimborsoDalCruscotto(300);
    const { status, corpo } = await dividi([{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 100 }]);
    expect(status).toBe(400);
    expect(JSON.stringify(corpo)).toMatch(/Le parti fanno 2,00\s€, ma il rimborso da dividere è 3,00\s€/);
    expect(riga('o1').refunded_amount_cents).toBe(0);
    expect(riga('o2').refunded_amount_cents).toBe(0);
    expect(await pagabili()).toEqual([]);
  });

  it('un doppio clic non registra due volte: il secondo trova i bonifici già sbloccati', async () => {
    await rimborsoDalCruscotto(300);
    await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);
    const secondo = await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);
    expect(secondo.status).toBe(409);
    expect(riga('o2').refunded_amount_cents).toBe(300);
    expect(stato.storni).toHaveLength(1);
  });

  it('il pannello vede il carrello fermo, con quanto dividere e i nomi dei negozi', async () => {
    await rimborsoDalCruscotto(300);
    const res = await (GET as unknown as (req: Request) => Promise<Response>)(new Request('http://x'));
    const corpo = (await res.json()) as { data: { carrelli: Array<Record<string, unknown>> } };
    expect(corpo.data.carrelli).toEqual([
      expect.objectContaining({
        pagamento: 'pi_1',
        daDividereCents: 300,
        ordini: [
          expect.objectContaining({ id: 'o1', negozio: 'Pane Quotidiano', restaCents: 1500, bonificoPartito: false }),
          expect.objectContaining({ id: 'o2', negozio: 'Il fioraio', restaCents: 1290, bonificoPartito: true }),
        ],
      }),
    ]);
  });
});

/** Un reso deciso dal sito sul pane, la cui risposta di Stripe si perde: il rimborso c'è, il segno sull'ordine no. */
async function resoDelSitoConLaRispostaPersa(): Promise<void> {
  stato.rispostePerse = 1;
  await expect(refundOrder({ orderId: 'o1', amountCents: 500, reason: 'reso', idempotencyKey: 'return_r1' })).rejects.toThrow();
  await handleChargeRefunded({
    id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: 2790, amount_refunded: stato.carica.refunded,
  } as unknown as Parameters<typeof handleChargeRefunded>[0]);
}

const avvisiDaDividere = () => stato.db.tabelle.notifications!.filter((n) => String(n.title).includes('da dividere'));

describe('una divisione che si inceppa a metà non lascia i soldi divisi «da fuori» (riesame del 16/10)', () => {
  it('IL CASO DEL RIESAME — la scrittura dei fiori va in timeout, al secondo tentativo il rimborso riceve lo stesso l etichetta', async () => {
    await rimborsoDalCruscotto(300);
    // La scrittura dei fiori (la loro parte: 200) va in timeout una volta.
    let guasti = 1;
    stato.db.guasto = (s) => {
      const valori = s.valori as Riga | null;
      if (guasti > 0 && s.tabella === 'orders' && s.operazione === 'update' && valori?.refunded_amount_cents === 200) {
        guasti -= 1;
        return TIMEOUT;
      }
      return null;
    };

    const primo = await dividi([{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 200 }]);
    expect(primo.status).toBe(409);
    expect(riga('o1').refunded_amount_cents).toBe(100);
    // Al secondo tentativo restano 2 € da dividere: tutti ai fiori.
    const secondo = await dividi([{ ordine: 'o2', centesimi: 200 }]);
    expect(secondo.status, JSON.stringify(secondo.corpo)).toBe(200);
    expect(riga('o2').refunded_amount_cents).toBe(200);

    expect(stato.suStripe[0].metadata.registrato_da_fuori, 'i 3 € divisi restano «da fuori» per sempre').toBe('1');

    // Poi un reso del sito perde la risposta di Stripe: i 3 € non tornano da dividere.
    const avvisiPrima = avvisiDaDividere().length;
    await resoDelSitoConLaRispostaPersa();
    expect(await pagabili(), 'i bonifici si fermano di nuovo per soldi già divisi').toEqual(['o1', 'o2']);
    expect(avvisiDaDividere().length).toBe(avvisiPrima);
  });

  it('se Stripe non mette l etichetta a divisione finita, il rimborso diviso non si chiede di nuovo', async () => {
    await rimborsoDalCruscotto(300);
    stato.etichetteRiescono = false;
    expect((await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }])).status).toBe(200);
    expect(stato.suStripe[0].metadata.registrato_da_fuori, 'qui l etichetta non c è: la prova è che basta l ordine').toBeUndefined();
    expect(riga('o2').stripe_refund_id, 'la divisione non ha scritto quale rimborso ha diviso').toContain('re_cruscotto_1');

    const avvisiPrima = avvisiDaDividere().length;
    await resoDelSitoConLaRispostaPersa();

    expect(await pagabili(), 'i bonifici si fermano di nuovo per soldi già divisi').toEqual(['o1', 'o2']);
    expect(avvisiDaDividere().length).toBe(avvisiPrima);
    expect(riga('o2').refunded_amount_cents).toBe(300);
  });

  it('un secondo rimborso dal cruscotto sullo stesso carrello si divide da solo, senza ricontare il primo', async () => {
    await rimborsoDalCruscotto(300);
    stato.etichetteRiescono = false;
    await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);
    stato.etichetteRiescono = true;

    await rimborsoDalCruscotto(200);

    const res = await (GET as unknown as (req: Request) => Promise<Response>)(new Request('http://x'));
    const corpo = (await res.json()) as { data: { carrelli: Array<{ daDividereCents: number }> } };
    expect(corpo.data.carrelli.map((c) => c.daDividereCents)).toEqual([200]);
    expect((await dividi([{ ordine: 'o1', centesimi: 200 }, { ordine: 'o2', centesimi: 0 }])).status).toBe(200);
    expect(stato.suStripe.map((r) => r.metadata.registrato_da_fuori)).toEqual(['1', '1']);
  });
});

describe('un pagamento che Stripe non lascia leggere non spegne il riquadro (riesame del 16/10)', () => {
  it('IL CASO DEL RIESAME — due carrelli fermi, Stripe non risponde su uno: l altro si divide lo stesso', async () => {
    await rimborsoDalCruscotto(300);
    // Un secondo carrello fermo, su un altro pagamento, che Stripe adesso non lascia leggere.
    stato.db.tabelle.orders!.push(
      ordine({ id: 'o3', seller_id: 'pane-quotidiano', total_price: 10, gross_total_cents: 1000, seller_payout_cents: 700, stripe_payment_intent: 'pi_2', internal_dispute_status: 'RIMBORSO_DA_RIPARTIRE' }),
    );
    stato.pagamentiIlleggibili.add('pi_2');

    const res = await (GET as unknown as (req: Request) => Promise<Response>)(new Request('http://x'));

    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data: { carrelli: Array<{ pagamento: string }>; nonLetti: Array<{ pagamento: string }> } };
    expect(corpo.data.carrelli.map((c) => c.pagamento), 'un pagamento illeggibile ha spento tutto il riquadro').toEqual(['pi_1']);
    expect(corpo.data.nonLetti.map((n) => n.pagamento)).toEqual(['pi_2']);
    expect((await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }])).status).toBe(200);
  });
});

describe('le regole della divisione, da sole', () => {
  const ordini = [
    { id: 'aaaaaa-1', lordoCents: 1500, giaRimborsatoCents: 0 },
    { id: 'bbbbbb-2', lordoCents: 1290, giaRimborsatoCents: 1200 },
  ];
  it('la somma deve essere esattamente il rimborso', () => {
    expect(controllaLaDivisione(ordini, [{ ordine: 'aaaaaa-1', centesimi: 300 }, { ordine: 'bbbbbb-2', centesimi: 0 }], 300).ok).toBe(true);
    expect(controllaLaDivisione(ordini, [{ ordine: 'aaaaaa-1', centesimi: 301 }, { ordine: 'bbbbbb-2', centesimi: 0 }], 300).ok).toBe(false);
  });
  it('nessuna parte oltre quello che resta da rimborsare su quell ordine', () => {
    const esito = controllaLaDivisione(ordini, [{ ordine: 'aaaaaa-1', centesimi: 200 }, { ordine: 'bbbbbb-2', centesimi: 100 }], 300);
    expect(esito).toMatchObject({ ok: false });
    expect(esito.ok ? '' : esito.errore).toMatch(/restano da rimborsare 0,90\s€/);
  });
  it('ogni ordine fermo ha la sua parte, e solo quelli', () => {
    expect(controllaLaDivisione(ordini, [{ ordine: 'aaaaaa-1', centesimi: 300 }], 300)).toMatchObject({ ok: false });
    expect(controllaLaDivisione(ordini, [
      { ordine: 'aaaaaa-1', centesimi: 300 }, { ordine: 'bbbbbb-2', centesimi: 0 }, { ordine: 'cccccc-3', centesimi: 0 },
    ], 300)).toMatchObject({ ok: false });
    expect(controllaLaDivisione(ordini, [
      { ordine: 'aaaaaa-1', centesimi: 150 }, { ordine: 'aaaaaa-1', centesimi: 150 }, { ordine: 'bbbbbb-2', centesimi: 0 },
    ], 300)).toMatchObject({ ok: false });
  });
  it('le cifre scritte da una persona', () => {
    expect(centesimiDaEuro('3')).toBe(300);
    expect(centesimiDaEuro('3,5')).toBe(350);
    expect(centesimiDaEuro(' 3,50 € ')).toBe(350);
    expect(centesimiDaEuro('3.05')).toBe(305);
    expect(centesimiDaEuro('')).toBe(0);
    expect(centesimiDaEuro('tre')).toBeNull();
    expect(centesimiDaEuro('3,505')).toBeNull();
    expect(centesimiDaEuro('-3')).toBeNull();
  });
});
