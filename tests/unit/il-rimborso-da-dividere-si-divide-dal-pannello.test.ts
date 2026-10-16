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
  /** Se c'è, Stripe risponde all'elenco dei rimborsi solo quando questa promessa si chiude. */
  primaDellaLista: (() => Promise<void>) | null;
  /** Se c'è, Stripe fa lo storno solo quando questa promessa si chiude (una che non si chiude mai è il processo morto). */
  primaDelloStorno: ((transferId: string) => Promise<void>) | null;
  /** Se c'è, la riga del registro delle azioni si scrive solo quando questa promessa si chiude. */
  primaDelRegistro: (() => Promise<void>) | null;
} = {
  db: fintoDatabase(), carica: { amount: 2790, refunded: 0 }, suStripe: [], storni: [],
  rispostePerse: 0, etichetteRiescono: true, pagamentiIlleggibili: new Set(), primaDellaLista: null, primaDelloStorno: null,
  primaDelRegistro: null,
};
let orologio = 1_800_000_000;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/audit', async (originale) => {
  const vero = await originale<typeof import('@/lib/audit')>();
  return {
    ...vero,
    writeAudit: async (voce: Parameters<typeof vero.writeAudit>[0]) => {
      if (stato.primaDelRegistro) await stato.primaDelRegistro();
      return vero.writeAudit(voce);
    },
  };
});
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
        if (stato.primaDellaLista) await stato.primaDellaLista();
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
        if (stato.primaDelloStorno) await stato.primaDelloStorno(transferId);
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
import { friendlyError } from '@/lib/errors';
import {
  idDellaDivisione,
  messaggioDellaParteNonScritta,
  ordiniGiaScritti,
  partiDaScrivere,
  restaDaDividere,
  stessaDivisione,
} from '@/lib/stripe/rimborsi-da-dividere';
import { segnoDelloStornoDaFare, stornoNonConfermato } from '@/lib/stripe/storno-senza-esito';

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

function daCapo(): void {
  stato.carica = { amount: 2790, refunded: 0 };
  stato.suStripe = [];
  stato.storni = [];
  stato.rispostePerse = 0;
  stato.etichetteRiescono = true;
  stato.pagamentiIlleggibili = new Set();
  stato.primaDellaLista = null;
  stato.primaDelloStorno = null;
  stato.primaDelRegistro = null;
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
}

beforeEach(daCapo);

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
    // 16/10 (terzo riesame) — quello che legge chi amministra: il riquadro passa il messaggio
    // del server da `friendlyError` (components/admin/RimborsiDaDividere.tsx), che sopra i 200
    // caratteri lo sostituiva con «Qualcosa non ha funzionato».
    const aVideo = friendlyError(new Error((primo.corpo.error as { message: string }).message));
    expect(aVideo, 'chi amministra non sa che una parte del rimborso è già registrata').toContain('1 ordine è già registrato');
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

const registratoInTutto = () => stato.db.tabelle.orders!.reduce((s, r) => s + Number(r.refunded_amount_cents ?? 0), 0);
const uscitoDaStripe = () => stato.suStripe.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount, 0);
const carrelliNelPannello = async () => {
  const res = await (GET as unknown as (req: Request) => Promise<Response>)(new Request('http://x'));
  return ((await res.json()) as { data: { carrelli: Array<{ pagamento: string; daDividereCents: number }> } }).data.carrelli;
};

describe('la divisione non si fa a metà mentre un reso del sito sta partendo (terzo riesame del 16/10)', () => {
  it('IL CASO DEL RIESAME — reso del sito da 2 € prenotato ma non ancora su Stripe: la divisione aspetta, e poi si divide tutto', async () => {
    await rimborsoDalCruscotto(300);
    // Un reso del sito sul pane, partito prima della pausa: l'importo è prenotato, Stripe non l'ha ancora fatto.
    await stato.db.client.rpc('accumula_rimborso', { p_order_id: 'o1', p_delta: 200 });
    expect((await carrelliNelPannello())[0].daDividereCents).toBe(100);

    const aMeta = await dividi([{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 0 }]);
    expect(aMeta.status, 'la divisione di 1 € su 3 è passata: i 2 € restanti non si dividono più').toBe(409);
    expect(JSON.stringify(aMeta.corpo)).toContain('rimborso del sito sta ancora partendo');
    expect(riga('o1')).toMatchObject({ refunded_amount_cents: 200, internal_dispute_status: 'RIMBORSO_DA_RIPARTIRE' });
    expect(riga('o1').stripe_refund_id ?? null, 'l id del rimborso da 3 € scritto su un ordine che ne ha avuto 1').toBeNull();

    // Il reso arriva su Stripe, e il suo avviso.
    stato.carica.refunded += 200;
    stato.suStripe.push({ id: 're_sito', amount: 200, status: 'succeeded', metadata: { order_id: 'o1' }, created: ++orologio });
    await handleChargeRefunded({
      id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: 2790, amount_refunded: stato.carica.refunded,
    } as unknown as Parameters<typeof handleChargeRefunded>[0]);

    expect((await carrelliNelPannello()).map((c) => c.daDividereCents)).toEqual([300]);
    expect((await dividi([{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 200 }])).status).toBe(200);
    expect(registratoInTutto(), 'soldi usciti al cliente e mai scritti su nessun ordine').toBe(uscitoDaStripe());
    expect(stato.suStripe[0].metadata.registrato_da_fuori).toBe('1');
    expect(await carrelliNelPannello()).toEqual([]);
  });
});

describe('dopo un rimborso pieno il carrello non resta fermo (terzo riesame del 16/10)', () => {
  beforeEach(() => {
    // Il rimborso pieno scrive al cliente: qui l'indirizzo non serve.
    (stato.db.client as unknown as Record<string, unknown>).auth = { admin: { getUserById: async () => ({ data: { user: { email: null } } }) } };
  });

  async function ilRestoDalCruscotto(): Promise<void> {
    const resto = stato.carica.amount - stato.carica.refunded;
    stato.carica.refunded = stato.carica.amount;
    stato.suStripe.push({ id: 're_resto', amount: resto, status: 'succeeded', metadata: {}, created: ++orologio });
    await handleChargeRefunded({
      id: 'ch_1', payment_intent: 'pi_1', refunded: true, amount: 2790, amount_refunded: stato.carica.refunded,
    } as unknown as Parameters<typeof handleChargeRefunded>[0]);
  }

  it('IL CASO DEL RIESAME — 3 € dal cruscotto, poi il resto: niente pausa, e il pannello non chiede di dividere 0,00 €', async () => {
    await rimborsoDalCruscotto(300);
    expect(riga('o1').internal_dispute_status).toBe('RIMBORSO_DA_RIPARTIRE');

    await ilRestoDalCruscotto();

    expect(riga('o1')).toMatchObject({ payment_status: 'REFUNDED', internal_dispute_status: null });
    expect(riga('o2')).toMatchObject({ payment_status: 'REFUNDED', internal_dispute_status: null });
    expect(await carrelliNelPannello(), 'carrello fantasma nel pannello').toEqual([]);
  });

  it('il rimborso pieno toglie solo la pausa: l esito di un reclamo sulla stessa colonna resta', async () => {
    riga('o1').internal_dispute_status = 'OPEN';
    await rimborsoDalCruscotto(300);
    expect(riga('o2').internal_dispute_status).toBe('RIMBORSO_DA_RIPARTIRE');

    await ilRestoDalCruscotto();

    expect(riga('o1').internal_dispute_status).toBe('OPEN');
    expect(riga('o2').internal_dispute_status).toBeNull();
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

describe('due divisioni che si incrociano, e una che si ferma a metà, registrano il rimborso una volta sola (sesto riesame del 16/10)', () => {
  /**
   * I casi del riesame: un carrello di tre negozi, il pane con un reclamo
   * aperto (non si ferma, ma la parte si può dare anche a lui), i fiori (col
   * bonifico già partito) e la macelleria fermi. Due schede mandano due
   * divisioni diverse; oppure una sola si ferma a metà.
   */
  const alPane = [{ ordine: 'o1', centesimi: 300 }, { ordine: 'o2', centesimi: 0 }, { ordine: 'o3', centesimi: 0 }];
  const aiFiori = [{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }, { ordine: 'o3', centesimi: 0 }];
  const allaMacelleria = [{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 0 }, { ordine: 'o3', centesimi: 300 }];
  type Parti = ReadonlyArray<{ ordine: string; centesimi: number }>;

  async function treNegoziColPaneInReclamo(): Promise<void> {
    stato.carica.amount = 4790;
    stato.db.tabelle.orders!.push(
      ordine({ id: 'o3', seller_id: 'macelleria', total_price: 20, gross_total_cents: 2000, seller_payout_cents: 1500 }),
    );
    riga('o1').internal_dispute_status = 'OPEN';
    await rimborsoDalCruscotto(300);
    expect(['o1', 'o2', 'o3'].map((id) => riga(id).internal_dispute_status)).toEqual(['OPEN', 'RIMBORSO_DA_RIPARTIRE', 'RIMBORSO_DA_RIPARTIRE']);
  }

  const dopo = async <T,>(passi: number, f: () => Promise<T>): Promise<T> => {
    for (let i = 0; i < passi; i++) await Promise.resolve();
    return f();
  };

  const aVideo = (esito: { corpo: Record<string, unknown> }) =>
    friendlyError(new Error(((esito.corpo.error as { message?: string } | undefined)?.message) ?? ''));

  /** Lo stato giusto dopo le divisioni: sugli ordini c'è UNA delle divisioni mandate, per intero, e niente più di fermo. */
  async function registrataUnaSola(quando: string, mandate: ReadonlyArray<Parti>): Promise<Parti> {
    const ordini = ['o1', 'o2', 'o3'];
    const sugliOrdini = ordini.map((id) => `${id}=${riga(id).refunded_amount_cents}`).join(' ');
    expect(registratoInTutto(), `${quando}: registrato sul database ≠ uscito da Stripe (${sugliOrdini})`).toBe(uscitoDaStripe());
    const vincente = mandate.find((p) => p.every((x) => Number(riga(x.ordine).refunded_amount_cents) === x.centesimi));
    expect(vincente, `${quando}: sugli ordini non c'è nessuna delle divisioni mandate (${sugliOrdini})`).toBeDefined();
    const conLaQuotaTolta = ordini.filter((id) => Number(riga(id).seller_payout_reversed_cents) > 0);
    expect(conLaQuotaTolta, `${quando}: la quota tolta a più di un negozio`).toHaveLength(1);
    expect(stato.storni.length, `${quando}: storni al fioraio`).toBe(Number(riga('o2').refunded_amount_cents) > 0 ? 1 : 0);
    expect(await carrelliNelPannello(), `${quando}: a divisione finita resta qualcosa di fermo`).toEqual([]);
    return vincente!;
  }

  it('in ogni momento in cui una scheda può partire rispetto all altra, si registra una divisione sola', async () => {
    const vincitori = new Set<string>();
    let incroci = 0;
    for (let scarto = -120; scarto <= 120; scarto += 2) {
      daCapo();
      await treNegoziColPaneInReclamo();
      const esiti = await Promise.all([
        dopo(Math.max(0, -scarto), () => dividi(alPane)),
        dopo(Math.max(0, scarto), () => dividi(aiFiori)),
      ]);
      const vincente = await registrataUnaSola(`scarto ${scarto}`, [alPane, aiFiori]);
      vincitori.add(vincente === alPane ? 'pane' : 'fiori');
      // Al massimo una scheda dice «fatto»: l'altra, se ha mandato altre cifre, sa che non sono state usate.
      expect(esiti.filter((e) => e.status === 200).length, `scarto ${scarto}: ${esiti.map((e) => e.status).join('/')}`).toBeLessThanOrEqual(1);
      const perdente = esiti.find((e) => (e === esiti[0] ? alPane : aiFiori) !== vincente)!;
      expect(perdente.status, `scarto ${scarto}: le cifre non usate risultano registrate`).not.toBe(200);
      // Chi ha trovato la divisione dell'altra col carrello ancora fermo si è incrociato davvero con lei.
      if (aVideo(perdente).includes('vale quella')) incroci++;
    }
    expect([...vincitori].sort(), 'ha vinto sempre la stessa scheda: la prova non ha girato le due parti').toEqual(['fiori', 'pane']);
    expect(incroci, 'nessun incrocio vero: nessuna scheda ha trovato la divisione dell altra a metà').toBeGreaterThan(0);
  });

  it('IL CASO DEL RIESAME — la seconda scheda legge il carrello dopo la prima scrittura della prima: vale la prima, e lo dice', async () => {
    for (const altra of [alPane, allaMacelleria]) {
      daCapo();
      await treNegoziColPaneInReclamo();
      // La prima scheda scrive i fiori; mentre Stripe fa lo storno, la seconda fa tutto il suo giro.
      let seconda: Promise<{ status: number; corpo: Record<string, unknown> }> | null = null;
      stato.primaDelloStorno = async () => {
        stato.primaDelloStorno = null;
        seconda = dividi(altra);
        await seconda;
      };

      const prima = await dividi(aiFiori);

      expect(seconda, 'la seconda scheda non è partita: la prova non ha incrociato niente').not.toBeNull();
      const due = await seconda!;
      expect(prima.status).toBe(200);
      expect(due.status).toBe(409);
      expect(aVideo(due), 'la seconda scheda non sa che le sue cifre non sono state usate').toContain('vale quella, e le cifre mandate adesso non le ho usate');
      expect(await registrataUnaSola(`seconda ${altra === alPane ? 'al pane' : 'alla macelleria'}`, [aiFiori, altra])).toBe(aiFiori);
    }
  });

  /**
   * Il caso del riesame: il pane è fermo e ha il bonifico già partito, i fiori
   * hanno un reclamo aperto (non si fermano). Dal cruscotto 3 €: 2 € al pane, 1 €
   * ai fiori. Il pane si scrive per primo, e lo storno della sua quota non
   * risponde mai: la funzione scade lì, prima di scrivere i fiori.
   */
  async function morteDopoIlPane(): Promise<void> {
    Object.assign(riga('o1'), { payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_o1' });
    Object.assign(riga('o2'), { payout_status: 'HELD', stripe_transfer_id: null, internal_dispute_status: 'OPEN' });
    await rimborsoDalCruscotto(300);
    expect([riga('o1').internal_dispute_status, riga('o2').internal_dispute_status]).toEqual(['RIMBORSO_DA_RIPARTIRE', 'OPEN']);

    stato.primaDelloStorno = () => new Promise<void>(() => {});
    void dividi([{ ordine: 'o1', centesimi: 200 }, { ordine: 'o2', centesimi: 100 }]);
    await new Promise((r) => setTimeout(r, 20));
    stato.primaDelloStorno = null;
    expect(riga('o1').refunded_amount_cents, 'la prova non si è fermata dopo il pane').toBe(200);
  }

  it('IL CASO DEL RIESAME — il processo muore a metà divisione: il carrello resta nel pannello, e la richiesta dopo finisce la divisione decisa', async () => {
    await morteDopoIlPane();

    expect(riga('o1').internal_dispute_status, 'la pausa del pane tolta prima che la parte dei fiori fosse scritta').toBe('RIMBORSO_DA_RIPARTIRE');
    expect(riga('o2').refunded_amount_cents).toBe(0);
    expect((await carrelliNelPannello()).map((c) => c.daDividereCents), 'il resto sparito dal pannello').toEqual([100]);
    expect(await pagabili(), 'i bonifici sbloccati con la parte dei fiori non scritta').toEqual([]);
    // Lo stesso avviso consegnato di nuovo non cambia niente.
    await handleChargeRefunded({
      id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: 2790, amount_refunded: stato.carica.refunded,
    } as unknown as Parameters<typeof handleChargeRefunded>[0]);
    expect((await carrelliNelPannello()).map((c) => c.daDividereCents)).toEqual([100]);

    // Un altro amministratore, con altre cifre per l'1 € che il pannello mostra: vale la divisione decisa.
    const dopoIlGuasto = await dividi([{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 0 }]);
    expect(dopoIlGuasto.status).toBe(409);
    expect(aVideo(dopoIlGuasto)).toContain('vale quella');
    expect(riga('o1')).toMatchObject({ refunded_amount_cents: 200, internal_dispute_status: null });
    expect(riga('o2')).toMatchObject({ refunded_amount_cents: 100, internal_dispute_status: 'OPEN' });
    expect(registratoInTutto(), 'soldi usciti e non scritti, o scritti due volte').toBe(uscitoDaStripe());
    expect(await carrelliNelPannello()).toEqual([]);
    expect(await pagabili()).toEqual(['o1']);
    expect(stato.suStripe[0].metadata.registrato_da_fuori).toBe('1');
  });

  it('il processo muore dopo che la parte del pane è scritta per intero, prima dei fiori: il carrello resta nel pannello', async () => {
    // Pane fermo col bonifico da fare (niente storno); fiori con un reclamo aperto.
    Object.assign(riga('o2'), { payout_status: 'HELD', stripe_transfer_id: null, internal_dispute_status: 'OPEN' });
    await rimborsoDalCruscotto(300);
    // La riga del registro dopo il pane non si scrive mai: la funzione scade lì.
    stato.primaDelRegistro = () => new Promise<void>(() => {});
    void dividi([{ ordine: 'o1', centesimi: 200 }, { ordine: 'o2', centesimi: 100 }]);
    await new Promise((r) => setTimeout(r, 20));
    stato.primaDelRegistro = null;

    expect(riga('o1')).toMatchObject({ refunded_amount_cents: 200, internal_dispute_status: 'RIMBORSO_DA_RIPARTIRE' });
    expect((await carrelliNelPannello()).map((c) => c.daDividereCents), 'il resto sparito dal pannello').toEqual([100]);
    expect(await pagabili()).toEqual([]);
    expect((await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 100 }])).status).toBe(200);
    expect(registratoInTutto()).toBe(300);
  });

  it('dopo il guasto, chi rimanda le parti che mancano della stessa divisione la finisce senza errori', async () => {
    await morteDopoIlPane();

    const resto = await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 100 }]);

    expect(resto.status, JSON.stringify(resto.corpo)).toBe(200);
    expect([riga('o1').refunded_amount_cents, riga('o2').refunded_amount_cents]).toEqual([200, 100]);
    expect(registratoInTutto()).toBe(300);
    expect(await carrelliNelPannello()).toEqual([]);
  });

  it('IL CASO DEL RIESAME — una divisione si ferma su un ordine mentre un altra scheda, letta prima, ne manda una diversa: mai più soldi registrati di quelli usciti', async () => {
    for (const primaChiParte of ['scheda1', 'scheda2'] as const) {
      daCapo();
      // I fiori fermi col bonifico partito; pane e salumi con un reclamo aperto.
      stato.carica.amount = 4790;
      stato.db.tabelle.orders!.push(
        ordine({ id: 'o3', seller_id: 'salumeria', total_price: 20, gross_total_cents: 2000, seller_payout_cents: 1500 }),
      );
      riga('o1').internal_dispute_status = 'OPEN';
      riga('o3').internal_dispute_status = 'OPEN';
      await rimborsoDalCruscotto(300);
      const scheda1 = [{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 0 }, { ordine: 'o3', centesimi: 200 }];
      const scheda2 = [{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }, { ordine: 'o3', centesimi: 0 }];
      // La scrittura dei salumi va in timeout, una volta.
      let guasti = 1;
      stato.db.guasto = (s) => {
        const valori = s.valori as Riga | null;
        if (guasti > 0 && s.tabella === 'orders' && s.operazione === 'update' && valori?.refunded_amount_cents === 200 && valori?.seller_payout_reversed_cents !== undefined) {
          guasti -= 1;
          return TIMEOUT;
        }
        return null;
      };
      // Tutte e due le schede leggono il carrello prima che una delle due scriva.
      let arrivate = 0;
      let apri: () => void = () => {};
      const tutteE2 = new Promise<void>((r) => { apri = r; });
      stato.primaDellaLista = async () => {
        if (++arrivate === 2) apri();
        await tutteE2;
      };

      const esiti = primaChiParte === 'scheda1'
        ? await Promise.all([dividi(scheda1), dividi(scheda2)])
        : await Promise.all([dividi(scheda2), dividi(scheda1)]);
      stato.primaDellaLista = null;

      // Due letture all'inizio (una per scheda); dopo, la rilettura di chi finisce (settimo riesame).
      expect(arrivate, 'le due schede non si sono incrociate').toBeGreaterThanOrEqual(2);
      expect(registratoInTutto(), `${primaChiParte}: registrati più soldi di quelli usciti (${esiti.map((e) => e.status).join('/')})`).toBeLessThanOrEqual(300);
      // Chi riprova (con le cifre che vuole) finisce la divisione decisa per prima.
      if ((await carrelliNelPannello()).length > 0) await dividi(scheda2);
      expect(registratoInTutto(), `${primaChiParte}: dopo il nuovo tentativo`).toBe(uscitoDaStripe());
      const vincente = [scheda1, scheda2].find((p) => p.every((x) => Number(riga(x.ordine).refunded_amount_cents) === x.centesimi));
      expect(vincente, `${primaChiParte}: sugli ordini c'è un misto delle due divisioni`).toBe(primaChiParte === 'scheda1' ? scheda1 : scheda2);
      expect(stato.storni.length).toBe(vincente === scheda2 ? 1 : 0);
      expect(await carrelliNelPannello()).toEqual([]);
    }
  });

  it('un doppio clic mentre la prima richiesta lavora ancora: i soldi si registrano una volta', async () => {
    await treNegoziColPaneInReclamo();
    let arrivate = 0;
    let apri: () => void = () => {};
    const tutteE2 = new Promise<void>((r) => { apri = r; });
    stato.primaDellaLista = async () => {
      if (++arrivate === 2) apri();
      await tutteE2;
    };

    const esiti = await Promise.all([dividi(aiFiori), dividi(aiFiori)]);

    expect(esiti.some((e) => e.status === 200), esiti.map((e) => JSON.stringify(e.corpo)).join(' | ')).toBe(true);
    expect(await registrataUnaSola('doppio clic', [aiFiori])).toBe(aiFiori);
  });

  it('se una scrittura non passa, il carrello resta nel pannello col resto e i bonifici restano fermi', async () => {
    riga('o1').internal_dispute_status = 'OPEN';
    await rimborsoDalCruscotto(300);
    // Il pane cambia sotto le mani proprio mentre si scrive la sua parte: la scrittura non prende la riga.
    stato.db.guasto = (s) => {
      const valori = s.valori as Riga | null;
      if (s.tabella === 'orders' && s.operazione === 'update' && valori?.refunded_amount_cents === 200) riga('o1').payout_status = 'PROCESSING';
      return null;
    };

    const esito = await dividi([{ ordine: 'o1', centesimi: 200 }, { ordine: 'o2', centesimi: 100 }]);

    expect(esito.status).toBe(409);
    // 16/10 (settimo riesame) — la divisione è già nel registro: il pannello lo dice.
    expect(aVideo(esito)).toContain('La divisione però è già decisa');
    expect(riga('o2')).toMatchObject({ refunded_amount_cents: 0, internal_dispute_status: 'RIMBORSO_DA_RIPARTIRE' });
    expect((await carrelliNelPannello()).map((c) => c.daDividereCents), 'il rimborso sparito dal pannello coi bonifici sbloccati').toEqual([300]);
    expect(await pagabili()).toEqual([]);
  });

  it('la divisione decisa resta scritta nel registro delle azioni: chi, quale pagamento, quali parti', async () => {
    await rimborsoDalCruscotto(300);
    await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);
    const decisione = stato.db.tabelle.audit_logs!.find((r) => r.id === idDellaDivisione('pi_1', ['re_cruscotto_1']));
    expect(decisione).toMatchObject({
      actor_id: 'admin1',
      action: 'order.refund',
      metadata: expect.objectContaining({ pagamento: 'pi_1', rimborsi: ['re_cruscotto_1'], parti: { o1: 0, o2: 300 } }),
    });
  });

  it('le regole della decisione, da sole', () => {
    // Lo stesso identificativo per gli stessi rimborsi in qualunque ordine; un altro per un altro pagamento o altri rimborsi.
    expect(idDellaDivisione('pi_1', ['re_b', 're_a'])).toBe(idDellaDivisione('pi_1', ['re_a', 're_b']));
    expect(idDellaDivisione('pi_1', ['re_a'])).not.toBe(idDellaDivisione('pi_1', ['re_a', 're_b']));
    expect(idDellaDivisione('pi_2', ['re_a'])).not.toBe(idDellaDivisione('pi_1', ['re_a']));
    expect(idDellaDivisione('pi_1', ['re_a'])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // Scritto vuol dire: tutti i rimborsi della divisione nell'elenco dell'ordine.
    const scritti = ordiniGiaScritti(
      [{ id: 'a', stripe_refund_id: 're_1,re_2' }, { id: 'b', stripe_refund_id: 're_1' }, { id: 'c', stripe_refund_id: null }],
      ['re_1', 're_2'],
    );
    expect([...scritti]).toEqual(['a']);
    expect([...ordiniGiaScritti([{ id: 'a', stripe_refund_id: 're_1' }], [])]).toEqual([]);

    // Resta da scrivere: le parti sopra zero sugli ordini non ancora scritti, in ordine di id.
    expect(partiDaScrivere({ c: 100, a: 200, b: 0, d: 50 }, new Set(['d']))).toEqual([
      { ordine: 'a', centesimi: 200 }, { ordine: 'c', centesimi: 100 },
    ]);

    // Le stesse cifre: ordine per ordine; su un ordine già scritto vale anche zero.
    const decisa = { o1: 100, o2: 200, o3: 0 };
    expect(stessaDivisione(decisa, [{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 200 }], new Set())).toBe(true);
    expect(stessaDivisione(decisa, [{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 200 }], new Set(['o1']))).toBe(true);
    expect(stessaDivisione(decisa, [{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 200 }], new Set())).toBe(false);
    expect(stessaDivisione(decisa, [{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 100 }, { ordine: 'o3', centesimi: 100 }], new Set())).toBe(false);
    expect(stessaDivisione(decisa, [{ ordine: 'o1', centesimi: 100 }, { ordine: 'o2', centesimi: 200 }, { ordine: 'o4', centesimi: 1 }], new Set())).toBe(false);
  });
});

describe('un rimborso che esce mentre si divide, uno storno senza esito, e la frase dopo un guasto (settimo riesame del 16/10)', () => {
  const aVideo = (esito: { corpo: Record<string, unknown> }) =>
    friendlyError(new Error(((esito.corpo.error as { message?: string } | undefined)?.message) ?? ''));
  const avvisi = (titolo: string) => stato.db.tabelle.notifications!.filter((n) => String(n.title).includes(titolo));
  const storniDaControllare = () => avvisi('Storno al negozio da controllare');
  /** Lo stato che non deve mai esserci: soldi usciti da Stripe che non sono né scritti su un ordine né nel pannello. */
  async function nienteSiPerde(quando: string): Promise<void> {
    const pannello = await carrelliNelPannello();
    const daDividere = pannello.reduce((s, c) => s + c.daDividereCents, 0);
    expect(registratoInTutto() + daDividere, `${quando}: soldi usciti, non scritti e non nel pannello`).toBe(uscitoDaStripe());
    if (daDividere > 0) expect(await pagabili(), `${quando}: c'è da dividere ma i bonifici ripartono`).toEqual([]);
  }

  it('IL CASO DEL RIESAME — mentre la divisione fa lo storno dei fiori escono altri 2 € dal cruscotto: il carrello torna fermo col resto', async () => {
    await rimborsoDalCruscotto(300);
    // Lo storno dei fiori è lento; intanto Nicola rimborsa altri 2 € dal cruscotto e arriva il loro avviso.
    stato.primaDelloStorno = async () => {
      stato.primaDelloStorno = null;
      await rimborsoDalCruscotto(200);
    };

    const esito = await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);

    expect(riga('o2').refunded_amount_cents).toBe(300);
    expect((await carrelliNelPannello()).map((c) => c.daDividereCents), 'il secondo rimborso sparito dal pannello').toEqual([200]);
    expect(await pagabili(), 'i bonifici ripartiti con 2 € usciti e non scritti').toEqual([]);
    await nienteSiPerde('dopo la prima divisione');
    // Chi ha diviso sa che non è finita: non legge «i bonifici ripartono».
    expect(esito.status).toBe(409);
    expect(aVideo(esito)).toContain('è uscito un altro rimborso');

    // I 2 € si dividono dal pannello come ogni altro rimborso, e tutto torna.
    expect((await dividi([{ ordine: 'o1', centesimi: 200 }, { ordine: 'o2', centesimi: 0 }])).status).toBe(200);
    expect(registratoInTutto()).toBe(uscitoDaStripe());
    expect(await carrelliNelPannello()).toEqual([]);
    expect(await pagabili()).toEqual(['o1', 'o2']);
    expect(stato.suStripe.map((r) => r.metadata.registrato_da_fuori)).toEqual(['1', '1']);
  });

  it('in ogni momento in cui può uscire il secondo rimborso, niente resta fuori dal pannello', async () => {
    let presiDallaDivisione = 0;
    let presiDallAvviso = 0;
    for (let passi = 0; passi <= 160; passi++) {
      daCapo();
      await rimborsoDalCruscotto(300);
      const [esito] = await Promise.all([
        dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]),
        (async () => {
          for (let i = 0; i < passi; i++) await Promise.resolve();
          await rimborsoDalCruscotto(200);
        })(),
      ]);
      await nienteSiPerde(`secondo rimborso dopo ${passi} passi (${esito.status})`);
      if (aVideo(esito).includes('è uscito un altro rimborso')) presiDallaDivisione++;
      else if (esito.status === 200 && (await carrelliNelPannello()).length > 0) presiDallAvviso++;
    }
    // La prova ha attraversato la finestra: in qualche caso il secondo rimborso
    // l'ha ritrovato la divisione, in altri il suo avviso a carrello già riaperto.
    expect(presiDallaDivisione, 'nessun caso nella finestra fra la lettura e la pausa tolta').toBeGreaterThan(0);
    expect(presiDallAvviso, 'nessun caso dopo la pausa tolta').toBeGreaterThan(0);
  });

  it('se dopo aver tolto la pausa Stripe non si lascia rileggere, il carrello torna fermo e premere di nuovo lo chiude', async () => {
    await rimborsoDalCruscotto(300);
    let liste = 0;
    stato.primaDellaLista = async () => {
      if (++liste === 2) throw new Error('Stripe non risponde');
    };

    const esito = await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);

    expect(esito.status).toBe(409);
    expect(aVideo(esito)).toContain('i bonifici sono ancora fermi');
    expect(await pagabili(), 'i bonifici ripartiti senza sapere se è uscito altro').toEqual([]);
    stato.primaDellaLista = null;
    const pannello = await carrelliNelPannello();
    expect(pannello.map((c) => c.daDividereCents)).toEqual([0]);
    // Il riquadro chiede le parti: tutte vuote fanno 0,00 € su 0,00 €.
    expect((await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 0 }])).status).toBe(200);
    expect(await carrelliNelPannello()).toEqual([]);
    expect(await pagabili()).toEqual(['o1', 'o2']);
    expect(registratoInTutto()).toBe(uscitoDaStripe());
  });

  it('se il carrello andava fermato di nuovo e il database non lo lascia fare, chi ha diviso non legge «restano fermi»', async () => {
    await rimborsoDalCruscotto(300);
    stato.primaDelloStorno = async () => {
      stato.primaDelloStorno = null;
      await rimborsoDalCruscotto(200);
      // Da qui in poi la pausa non si scrive più.
      stato.db.guasto = (sc) => {
        const valori = sc.valori as Riga | null;
        return sc.tabella === 'orders' && valori?.internal_dispute_status === 'RIMBORSO_DA_RIPARTIRE' ? TIMEOUT : null;
      };
    };

    const esito = await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }]);

    expect(await pagabili(), 'la prova non ha fatto cadere la pausa').toEqual(['o1', 'o2']);
    expect(esito.status).toBe(409);
    const testo = aVideo(esito);
    expect(testo, 'il riquadro ha sostituito la frase col testo generico').toContain('non sono riuscita a fermare di nuovo i bonifici');
    expect(testo).not.toContain('restano fermi');
  });

  it('il conto del resto, da solo', () => {
    const da = (id: string, amount: number, metadata: Record<string, string> = {}) => ({ id, amount, status: 'succeeded', metadata });
    // Divisione finita: il rimborso è scritto su un ordine (anche senza etichetta) e non resta niente.
    expect(restaDaDividere([{ refunded_amount_cents: 300, stripe_refund_id: 're_a' }, { refunded_amount_cents: 0, stripe_refund_id: null }], [da('re_a', 300)])).toBe(0);
    // Un secondo rimborso da fuori, non scritto da nessuna parte: resta lui.
    expect(restaDaDividere([{ refunded_amount_cents: 300, stripe_refund_id: 're_a' }], [da('re_b', 200), da('re_a', 300)])).toBe(200);
    // Un rimborso del sito ancora in viaggio (prenotato sull'ordine, non su Stripe): niente da dividere.
    expect(restaDaDividere([{ refunded_amount_cents: 800, stripe_refund_id: 're_a' }], [da('re_a', 300)])).toBe(0);
    // Un rimborso nostro con la risposta persa (etichetta dell'ordine): non è da fuori.
    expect(restaDaDividere([{ refunded_amount_cents: 300, stripe_refund_id: 're_a' }], [da('re_s', 500, { order_id: 'o1' }), da('re_a', 300)])).toBe(0);
  });

  /** Un pagamento con un ordine solo: i fiori, col bonifico già partito. */
  function soloIFiori(): void {
    stato.db.tabelle.orders = stato.db.tabelle.orders!.filter((r) => r.id === 'o2');
    stato.carica = { amount: 1290, refunded: 0 };
  }
  const avvisoDelCruscotto = () => handleChargeRefunded({
    id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: stato.carica.amount, amount_refunded: stato.carica.refunded,
  } as unknown as Parameters<typeof handleChargeRefunded>[0]);

  it('IL CASO DEL RIESAME — il webhook muore mentre chiede lo storno al fioraio: quando Stripe ripete l avviso, gli amministratori lo sanno', async () => {
    soloIFiori();
    stato.carica.refunded += 100;
    stato.suStripe.push({ id: 're_cruscotto_1', amount: 100, status: 'succeeded', metadata: {}, created: ++orologio });
    // Lo storno non risponde mai: la funzione scade lì.
    stato.primaDelloStorno = () => new Promise<void>(() => {});
    void avvisoDelCruscotto();
    await new Promise((r) => setTimeout(r, 20));
    stato.primaDelloStorno = null;
    expect(riga('o2').refunded_amount_cents, 'la prova non si è fermata dopo la scrittura del rimborso').toBe(100);
    expect(stato.storni).toEqual([]);
    // Il segno è sull'ordine, scritto insieme al rimborso: 100 × 900 ÷ 1290 = 70 centesimi.
    expect(stornoNonConfermato(riga('o2').reversal_error as string | null)).toBe(70);

    // Stripe ripete l'avviso (la prima consegna non ha avuto risposta): il rimborso non si riscrive, ma si avvisa.
    await avvisoDelCruscotto();
    await avvisoDelCruscotto();

    expect(riga('o2').refunded_amount_cents).toBe(100);
    expect(stato.storni, 'lo storno rifatto da solo: la risposta di Stripe può essersi persa con lo storno fatto').toEqual([]);
    const avvisiMandati = storniDaControllare();
    expect(avvisiMandati.length, 'quota del negozio persa in silenzio').toBe(1);
    expect(String(avvisiMandati[0].body)).toContain('0,70');
  });

  it('se lo storno riesce, il segno sparisce e nessun avviso arriva dopo', async () => {
    soloIFiori();
    stato.carica.refunded += 100;
    stato.suStripe.push({ id: 're_cruscotto_1', amount: 100, status: 'succeeded', metadata: {}, created: ++orologio });
    await avvisoDelCruscotto();
    await avvisoDelCruscotto();

    expect(stato.storni).toEqual([expect.objectContaining({ transferId: 'tr_o2', amount: 70 })]);
    expect(riga('o2')).toMatchObject({ refunded_amount_cents: 100, reversal_error: null, payout_status: 'TRANSFERRED' });
    expect(storniDaControllare()).toEqual([]);
  });

  it('IL CASO DEL RIESAME — la divisione muore durante lo storno del pane: chi la riprende la finisce e avvisa che lo storno va controllato', async () => {
    Object.assign(riga('o1'), { payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_o1' });
    Object.assign(riga('o2'), { payout_status: 'HELD', stripe_transfer_id: null, internal_dispute_status: 'OPEN' });
    await rimborsoDalCruscotto(300);
    stato.primaDelloStorno = () => new Promise<void>(() => {});
    void dividi([{ ordine: 'o1', centesimi: 200 }, { ordine: 'o2', centesimi: 100 }]);
    await new Promise((r) => setTimeout(r, 20));
    stato.primaDelloStorno = null;
    expect(riga('o1').refunded_amount_cents, 'la prova non si è fermata dopo il pane').toBe(200);
    expect(storniDaControllare()).toEqual([]);

    const ripresa = await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 100 }]);

    expect(ripresa.status, JSON.stringify(ripresa.corpo)).toBe(200);
    expect(registratoInTutto()).toBe(uscitoDaStripe());
    expect(stato.storni, 'lo storno del pane rifatto da solo').toEqual([]);
    // 200 × 1000 ÷ 1500 = 133 centesimi da riprendere al pane.
    expect(storniDaControllare().map((n) => String(n.body).includes('1,33')), 'quota del pane persa in silenzio').toEqual([true]);
    // Il segno resta sull'ordine: dice ancora, a chi guarda, che lo storno non ha un esito.
    expect(stornoNonConfermato(riga('o1').reversal_error as string | null)).toBe(133);
  });

  it('una divisione normale non lascia segni né avvisi da controllare', async () => {
    await rimborsoDalCruscotto(300);
    expect((await dividi([{ ordine: 'o1', centesimi: 0 }, { ordine: 'o2', centesimi: 300 }])).status).toBe(200);
    expect(riga('o2').reversal_error ?? null).toBeNull();
    expect(storniDaControllare()).toEqual([]);
  });

  it('il segno dello storno, da solo', () => {
    expect(stornoNonConfermato(segnoDelloStornoDaFare(70, ['re_1', 're_2']))).toBe(70);
    expect(stornoNonConfermato(segnoDelloStornoDaFare(133, []))).toBe(133);
    // Il motivo di uno storno fallito davvero non è il segno: lì l'avviso è già partito.
    expect(stornoNonConfermato('Insufficient funds in the connected account')).toBeNull();
    expect(stornoNonConfermato(null)).toBeNull();
  });

  it('IL CASO DEL RIESAME — la prima scrittura va in timeout: il pannello dice che la divisione è decisa, e rimandarla uguale la finisce', async () => {
    await rimborsoDalCruscotto(300);
    let guasti = 1;
    stato.db.guasto = (s) => {
      const valori = s.valori as Riga | null;
      if (guasti > 0 && s.tabella === 'orders' && s.operazione === 'update' && valori?.refunded_amount_cents === 300) {
        guasti -= 1;
        return TIMEOUT;
      }
      return null;
    };
    const mandate = [{ ordine: 'o1', centesimi: 300 }, { ordine: 'o2', centesimi: 0 }];

    const primo = await dividi(mandate);

    expect(primo.status).toBe(409);
    expect(registratoInTutto()).toBe(0);
    // Sugli ordini non c'è niente, ma nel registro la divisione c'è già: il pannello non deve dire il contrario.
    const decisione = stato.db.tabelle.audit_logs!.find((r) => r.id === idDellaDivisione('pi_1', ['re_cruscotto_1']));
    expect((decisione?.metadata as { parti?: unknown } | undefined)?.parti).toEqual({ o1: 300, o2: 0 });
    const testo = aVideo(primo);
    expect(testo, 'il pannello dice «non ho registrato niente» con la divisione già decisa').not.toMatch(/non ho registrato niente/i);
    expect(testo).toContain('La divisione però è già decisa');
    expect(testo).toContain('rimanda le stesse cifre');

    // Chi fa quello che dice il messaggio finisce la divisione.
    const secondo = await dividi(mandate);
    expect(secondo.status, JSON.stringify(secondo.corpo)).toBe(200);
    expect(riga('o1')).toMatchObject({ refunded_amount_cents: 300, internal_dispute_status: null });
    expect(registratoInTutto()).toBe(uscitoDaStripe());
  });

  it('la frase dopo un guasto arriva intera al riquadro, qualunque sia il conto degli ordini già scritti', () => {
    // Fino a 49: una divisione ha al massimo 50 parti (la rotta).
    for (const gia of [0, 1, 2, 12, 49]) {
      const frase = messaggioDellaParteNonScritta('0b5c8f1e-aaaa-bbbb-cccc-1234567890ab', gia);
      expect(friendlyError(new Error(frase)), `${gia} già scritti: il riquadro la sostituisce col testo generico`).toBe(frase);
    }
    expect(messaggioDellaParteNonScritta('o1', 0)).toContain('già decisa');
    expect(messaggioDellaParteNonScritta('o1', 1)).toContain('1 ordine è già registrato');
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
