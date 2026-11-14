import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaLibro, ordineConCarta, type Libro } from './aiuti/riparazione-r17-libro-dei-rimborsi-finto';

/**
 * 14/11/2026 (R17-015 correzione) — LA QUOTA DEL NEGOZIO SCRITTA MENTRE PARTE IL BONIFICO.
 *
 * Ieri si è chiusa la finestra fra la lettura dell'ordine e il turno del bonifico. Restava la
 * seconda scrittrice: `refundOrder` legge l'ordine (bonifico HELD), chiede il rimborso a Stripe, e
 * solo dopo scrive la quota del negozio «nel bonifico da fare». In quel secondo il giro può prendere
 * il turno e far partire il bonifico col netto intero: la quota restava sulla carta e il negozio
 * teneva tutto. Ordine da 30 € con la carta, al negozio 27 €; reso parziale di 10 €: al negozio
 * vanno tolti 9 €, quindi alla fine deve avere 18 €, non 27.
 *
 *  ① il bonifico parte mentre Stripe rimborsa: la quota si riprende con uno storno;
 *  ② la quota si scrive mentre il bonifico sta partendo (PROCESSING): la differenza si storna
 *    appena il bonifico è registrato;
 *  ③ rifare lo stesso conto non fa un secondo storno.
 */

type Bonifico = { id: string; amount: number; amount_reversed: number; metadata: Record<string, string>; chiave: string };

const stato: {
  libro: Libro;
  bonifici: Bonifico[];
  storni: Array<{ transferId: string; amount: number; chiave: string }>;
  tentativiDiStorno: string[];
  rimborsi: Array<{ id: string; amount: number; chiave: string }>;
  avvisi: string[];
  /** Cosa succede dentro Stripe mentre esegue il rimborso. */
  duranteIlRimborso: (() => Promise<unknown>) | null;
  /** Cosa succede dentro Stripe mentre esegue il bonifico. */
  duranteIlBonifico: (() => Promise<unknown>) | null;
  storniRifiutati: boolean;
  /** Stripe non dice quanto del bonifico è già stornato (una risposta vecchia). */
  elencoSenzaStornato: boolean;
} = {
  libro: creaLibro({}), bonifici: [], storni: [], tentativiDiStorno: [], rimborsi: [], avvisi: [],
  duranteIlRimborso: null, duranteIlBonifico: null, storniRifiutati: false, elencoSenzaStornato: false,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/webhook/comune', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  notifyAdmins: vi.fn(async (titolo: string, testo: string) => {
    stato.avvisi.push(`${titolo} — ${testo}`);
    return 'scritto';
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: async (p: { amount: number }, o: { idempotencyKey: string }) => {
        const gia = stato.rimborsi.find((r) => r.chiave === o.idempotencyKey);
        if (gia) return { id: gia.id, status: 'succeeded' };
        const nuovo = { id: `re_${stato.rimborsi.length + 1}`, amount: p.amount, chiave: o.idempotencyKey };
        stato.rimborsi.push(nuovo);
        const durante = stato.duranteIlRimborso;
        stato.duranteIlRimborso = null;
        if (durante) await durante();
        return { id: nuovo.id, status: 'succeeded' };
      },
      list: async () => ({ data: stato.rimborsi.map((r) => ({ id: r.id, amount: r.amount, status: 'succeeded', metadata: {} })), has_more: false }),
    },
    transfers: {
      create: async (p: { amount: number; metadata: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = stato.bonifici.find((b) => b.chiave === o.idempotencyKey);
        if (gia) return { id: gia.id };
        const nuovo = { id: `tr_${stato.bonifici.length + 1}`, amount: p.amount, amount_reversed: 0, metadata: { ...p.metadata }, chiave: o.idempotencyKey };
        stato.bonifici.push(nuovo);
        const durante = stato.duranteIlBonifico;
        stato.duranteIlBonifico = null;
        if (durante) await durante();
        return { id: nuovo.id };
      },
      list: async () => ({
        data: stato.bonifici.map((b) => ({
          id: b.id, amount: b.amount, metadata: { ...b.metadata },
          ...(stato.elencoSenzaStornato ? {} : { amount_reversed: b.amount_reversed }),
        })),
      }),
      retrieve: async (id: string) => {
        const b = stato.bonifici.find((x) => x.id === id);
        if (!b) throw new Error(`No such transfer: ${id}`);
        return { id: b.id, amount: b.amount, amount_reversed: b.amount_reversed };
      },
      createReversal: async (transferId: string, p: { amount: number }, o: { idempotencyKey: string }) => {
        stato.tentativiDiStorno.push(o.idempotencyKey);
        if (stato.storniRifiutati) throw new Error('Insufficient funds in the connected account');
        // Stripe vero: la stessa chiave restituisce lo stesso storno, non ne fa un secondo.
        if (!stato.storni.some((s) => s.chiave === o.idempotencyKey)) {
          stato.storni.push({ transferId, amount: p.amount, chiave: o.idempotencyKey });
          const b = stato.bonifici.find((x) => x.id === transferId);
          if (b) b.amount_reversed += p.amount;
        }
        return { id: `trr_${o.idempotencyKey}` };
      },
    },
  }),
}));

import { refundOrder, releaseOrderPayout } from '@/lib/stripe/payout';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
/** Quanto il negozio ha in mano: i bonifici meno gli storni. */
const alNegozio = () => stato.bonifici.reduce((s, b) => s + b.amount, 0) - stato.storni.reduce((s, x) => s + x.amount, 0);

const resoDi10Euro = () =>
  refundOrder({ orderId: 'o1', amountCents: 1000, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
  stato.bonifici = [];
  stato.storni = [];
  stato.tentativiDiStorno = [];
  stato.rimborsi = [];
  stato.avvisi = [];
  stato.duranteIlRimborso = null;
  stato.duranteIlBonifico = null;
  stato.storniRifiutati = false;
  stato.elencoSenzaStornato = false;
  stato.libro = creaLibro({
    orders: [
      ordineConCarta({
        total_price: 30, gross_total_cents: 3000, seller_payout_cents: 2700, seller_payout_reversed_cents: 0,
        payout_status: 'HELD', stripe_transfer_id: null, payout_tentativo: 0, payout_claimed_at: null,
        stripe_charge_id: 'ch_1', stripe_transfer_group: 'order_o1', delivered_at: '2026-11-14T08:00:00.000Z',
      }),
    ],
    profiles: [
      { id: 'admin1', role: 'admin' },
      { id: 'negozio1', role: 'seller', stripe_account_id: 'acct_negozio', stripe_payouts_enabled: true },
    ],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-015 · la quota scritta mentre parte il bonifico non resta sulla carta', () => {
  it('① il bonifico parte (netto intero) mentre Stripe rimborsa: la quota si riprende con uno storno, al negozio 18 €', async () => {
    stato.duranteIlRimborso = () => releaseOrderPayout('o1');

    await resoDi10Euro();

    expect(stato.bonifici.map((b) => b.amount)).toEqual([2700]);
    expect(stato.storni.map((s) => [s.transferId, s.amount])).toEqual([['tr_1', 900]]);
    expect(alNegozio()).toBe(1800);
    // La quota sale una volta sola: lo storno, non anche «tolta dal bonifico da fare».
    expect(ordine().seller_payout_reversed_cents).toBe(900);
    expect(ordine().payout_status).toBe('TRANSFERRED');
    expect(ordine().refunded_amount_cents).toBe(1000);
  });

  it('① se lo storno cade, l ordine diventa REVERSAL_FAILED e gli amministratori lo sanno', async () => {
    stato.duranteIlRimborso = () => releaseOrderPayout('o1');
    stato.storniRifiutati = true;

    await resoDi10Euro();

    expect(ordine().payout_status).toBe('REVERSAL_FAILED');
    expect(String(ordine().reversal_error)).toContain('Insufficient funds');
    expect(stato.avvisi.some((a) => a.includes('Storno al venditore non riuscito'))).toBe(true);
    expect(ordine().seller_payout_reversed_cents).toBe(0);
  });

  it('① col rimborso pieno il bonifico partito nel frattempo si riprende tutto, una volta sola, e l ordine resta REVERSED', async () => {
    stato.duranteIlRimborso = () => releaseOrderPayout('o1');

    const esito = await refundOrder({ orderId: 'o1', amountCents: 3000, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });

    expect(esito.pieno).toBe(true);
    expect(stato.bonifici.map((b) => b.amount)).toEqual([2700]);
    expect(stato.storni.map((s) => s.amount)).toEqual([2700]);
    expect(alNegozio()).toBe(0);
    expect(ordine().seller_payout_reversed_cents).toBe(2700);
    // Bonifico partito e ripreso: se poi la banca respinge il rimborso, si rifà con un tentativo nuovo.
    expect(ordine().payout_status).toBe('REVERSED');
  });

  it('② la quota si scrive mentre il bonifico sta partendo: la differenza si storna appena il bonifico è registrato', async () => {
    stato.duranteIlBonifico = () => resoDi10Euro();

    const esito = await releaseOrderPayout('o1');

    expect(esito).toEqual({ ok: true, transferId: 'tr_1' });
    expect(stato.bonifici.map((b) => b.amount)).toEqual([2700]);
    expect(stato.storni.map((s) => [s.transferId, s.amount])).toEqual([['tr_1', 900]]);
    expect(alNegozio()).toBe(1800);
    // La quota era già contata quando si è scritta: lo storno non la conta una seconda volta.
    expect(ordine().seller_payout_reversed_cents).toBe(900);
    expect(ordine().payout_status).toBe('TRANSFERRED');
    expect(ordine().stripe_reversal_id).toBeTruthy();
  });

  it('② se quello storno cade, l ordine diventa REVERSAL_FAILED e gli amministratori lo sanno', async () => {
    stato.duranteIlBonifico = () => resoDi10Euro();
    stato.storniRifiutati = true;

    await releaseOrderPayout('o1');

    expect(ordine().payout_status).toBe('REVERSAL_FAILED');
    expect(stato.avvisi.some((a) => a.includes('Storno al venditore non riuscito') && a.includes('9,00'))).toBe(true);
  });

  it('③ rifare la registrazione dello stesso bonifico non fa un secondo storno', async () => {
    stato.duranteIlBonifico = () => resoDi10Euro();
    await releaseOrderPayout('o1');
    expect(stato.storni).toHaveLength(1);

    // Lo stesso bonifico torna a registrarsi (l'ordine rimesso in coda come se la scrittura si fosse
    // persa), e Stripe nell'elenco non dice quanto ne è già stornato: decide la chiave dello storno.
    stato.elencoSenzaStornato = true;
    Object.assign(ordine(), { payout_status: 'HELD', stripe_transfer_id: null });
    await releaseOrderPayout('o1');
    // E ancora una volta, con l'elenco che lo dice: il conto torna a zero.
    stato.elencoSenzaStornato = false;
    Object.assign(ordine(), { payout_status: 'HELD', stripe_transfer_id: null });
    await releaseOrderPayout('o1');

    expect(stato.bonifici).toHaveLength(1);
    expect(stato.storni).toHaveLength(1);
    expect(alNegozio()).toBe(1800);
    expect(ordine().seller_payout_reversed_cents).toBe(900);
    expect(ordine().stripe_transfer_id).toBe('tr_1');
  });
});
