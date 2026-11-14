import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';
import { creaLibro, creaStripe, type Libro, type StripeFinto } from './aiuti/riparazione-r17-libro-dei-rimborsi-finto';

/**
 * 14/11/2026 (R17-016 correzione) — L'EURO DEL FRENO RIMASTO PRENOTATO SU UN ORDINE ANNULLATO O ACCETTATO.
 *
 * Maria ordina con la veloce alle 18:05 (19 €), paga con la carta, il forno non conferma. Il giro del
 * freno delle 18:16 prenota l'euro da renderle e muore prima che la richiesta arrivi a Stripe: 1 €
 * segnato come reso, nessun soldo uscito. La cura di ieri lo finiva solo se l'ordine restava nuovo e
 * «Adesso». Ma se intanto Maria annulla, l'annullo rende «totale meno già rimborsato» (18 €): l'euro
 * non le torna più. Se intanto il forno accetta, l'euro resta prenotato e nessuno lo rende. Adesso il
 * freno cerca anche le sue prenotazioni rimaste (più vecchie di 10 minuti) sugli ordini non più nuovi
 * e finisce il rimborso con la stessa chiave: una volta sola, e niente se l'euro è già uscito.
 * E nei 10 minuti, quando il giro trova l'euro già prenotato da un giro di prima, gli amministratori
 * lo sanno (una volta), invece del silenzio.
 */

const stato: { libro: Libro; stripe: StripeFinto; senzaTabella: boolean } = {
  libro: creaLibro({}), stripe: creaStripe(), senzaTabella: false,
};

/**
 * La tabella del libro letta come la legge PostgREST (`like`, `lt`, `gt`, `limit`), sulle righe del
 * libro finto; `senzaTabella` imita il database senza la 412 (PGRST205).
 */
function prenotazioniDelLibro() {
  const filtri: Array<(p: Record<string, unknown>) => boolean> = [];
  const comeData = (x: unknown) => (typeof x === 'number' ? x : new Date(String(x)).getTime());
  const q = {
    select: () => q,
    like: (colonna: string, schema: string) => {
      const re = new RegExp(`^${[...schema].map((ch) => (ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
      filtri.push((p) => re.test(String(p[colonna])));
      return q;
    },
    lt: (colonna: string, valore: string) => { filtri.push((p) => comeData(p[colonna]) < comeData(valore)); return q; },
    gt: (colonna: string, valore: string) => { filtri.push((p) => comeData(p[colonna]) > comeData(valore)); return q; },
    limit: () => q,
    then: <T>(risolvi: (v: { data: unknown; error: { code: string; message: string } | null }) => T) =>
      Promise.resolve(
        stato.senzaTabella
          ? { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.prenotazioni_dei_rimborsi' in the schema cache" } }
          : {
              data: stato.libro.prenotazioni
                .map((p) => ({ ...p, preso_il: new Date(p.preso_il).toISOString() }))
                .filter((p) => filtri.every((f) => f(p as unknown as Record<string, unknown>))),
              error: null,
            },
      ).then(risolvi),
  };
  return q;
}

const client = () => ({
  ...stato.libro.client,
  from: (tabella: string) => (tabella === 'prenotazioni_dei_rimborsi' ? prenotazioniDelLibro() : stato.libro.client.from(tabella)),
});

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => client() }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stato.stripe.client() }));

import { frenoDellaVeloce } from '@/lib/ordini/veloce-non-confermata';
import { refundOrder } from '@/lib/stripe/payout';

function ordineVeloce() {
  return {
    id: 'o1', user_id: 'maria', seller_id: 'forno', delivery_status: 'NEW', delivery_slot: ETICHETTA_ADESSO,
    pickup_in_store: false, payment_method: 'card', payment_status: 'PAID', total_price: 19, gross_total_cents: 1900,
    wallet_applied_cents: 0, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
    stripe_session_id: 'cs_1', stripe_payment_intent: 'pi_1', stripe_refund_id: null, refunded_amount_cents: 0,
    seller_payout_cents: 1350, seller_payout_reversed_cents: 0, payout_status: 'PENDING', rider_id: null,
    stripe_transfer_id: null, internal_dispute_status: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, created_at: '2026-10-30T17:05:00.000Z',
  };
}

const admin = () => client() as unknown as Parameters<typeof frenoDellaVeloce>[0];
const o1 = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const avvisiAgliAmministratori = () =>
  (stato.libro.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'admin1').map((n) => `${String(n.title)} — ${String(n.body)}`);
/** I rimborsi su Stripe con la chiave del freno (i soldi usciti per l'euro). */
const euroUsciti = () => stato.stripe.suStripe.filter((r) => r.chiave === 'veloce_non_confermata_o1').map((r) => r.amount);

async function giro(ora: string) {
  vi.setSystemTime(new Date(ora));
  return frenoDellaVeloce(admin(), new Date(ora));
}

/** Il giro delle 18:16 prenota l'euro e muore prima di Stripe (la funzione che scade lì dentro). */
async function giroCheMuorePrimaDiStripe() {
  stato.stripe.createMuore = true;
  vi.setSystemTime(new Date('2026-10-30T17:16:00.000Z'));
  void frenoDellaVeloce(admin(), new Date('2026-10-30T17:16:00.000Z'));
  await vi.waitFor(() => expect(o1().refunded_amount_cents).toBe(100));
  expect(stato.stripe.creati).toEqual([]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  stato.stripe = creaStripe();
  stato.senzaTabella = false;
  stato.libro = creaLibro({
    orders: [ordineVeloce()],
    profiles: [{ id: 'forno', store_hours: null }, { id: 'admin1', role: 'admin' }],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-016 · l euro del freno rimasto prenotato quando l ordine non è più nuovo', () => {
  it('ordine annullato (l annullo ha reso 18 €): il freno rende l euro una volta sola, e al giro dopo non ne rende un altro', async () => {
    await giroCheMuorePrimaDiStripe();
    // Alle 18:20 Maria annulla: l'annullo rende il totale meno il già rimborsato (19 − 1 = 18 €).
    vi.setSystemTime(new Date('2026-10-30T17:20:00.000Z'));
    await refundOrder({ orderId: 'o1', amountCents: 1800, reason: 'annullato dal cliente', notifyBuyer: false });
    expect(o1().delivery_status).toBe('CANCELED');
    expect(o1().refunded_amount_cents).toBe(1900);
    expect(stato.stripe.creati).toEqual([1800]);

    const esito = await giro('2026-10-30T17:31:00.000Z');

    expect(euroUsciti()).toEqual([100]);
    expect(stato.stripe.creati).toEqual([1800, 100]);
    expect(o1().refunded_amount_cents).toBe(1900);
    expect(esito).toMatchObject({ ok: true, euroRipresi: 1 });

    // Al giro dopo (e a quello dopo ancora, passati altri 10 minuti) non esce un altro euro.
    await giro('2026-10-30T17:36:00.000Z');
    await giro('2026-10-30T17:47:00.000Z');
    expect(euroUsciti()).toEqual([100]);
    expect(o1().refunded_amount_cents).toBe(1900);
  });

  it('ordine accettato dal forno intanto: il freno rende l euro una volta sola, il libro resta a 1 €', async () => {
    await giroCheMuorePrimaDiStripe();
    Object.assign(o1(), { delivery_status: 'ACCEPTED' });

    await giro('2026-10-30T17:31:00.000Z');
    await giro('2026-10-30T17:36:00.000Z');
    await giro('2026-10-30T17:47:00.000Z');

    expect(euroUsciti()).toEqual([100]);
    expect(o1().refunded_amount_cents).toBe(100);
    expect(String(o1().stripe_refund_id)).toContain(stato.stripe.suStripe[0].id);
    // La veloce l'ha confermata il negozio: la fascia non si tocca.
    expect(o1().delivery_slot).toBe(ETICHETTA_ADESSO);
  });

  it('euro già uscito su Stripe prima che il giro morisse: nessun rimborso nuovo', async () => {
    stato.stripe.createPoiMuore = true;
    vi.setSystemTime(new Date('2026-10-30T17:16:00.000Z'));
    void frenoDellaVeloce(admin(), new Date('2026-10-30T17:16:00.000Z'));
    await vi.waitFor(() => expect(stato.stripe.creati).toEqual([100]));
    Object.assign(o1(), { delivery_status: 'ACCEPTED' });

    await giro('2026-10-30T17:31:00.000Z');
    await giro('2026-10-30T17:47:00.000Z');

    expect(euroUsciti()).toEqual([100]);
    expect(stato.stripe.creati).toEqual([100]);
    expect(o1().refunded_amount_cents).toBe(100);
  });

  it('nei 10 minuti, con l euro già prenotato da un giro di prima: «riprova» e un avviso agli amministratori, una volta', async () => {
    await giroCheMuorePrimaDiStripe();

    const primo = await giro('2026-10-30T17:21:00.000Z');
    await giro('2026-10-30T17:24:00.000Z');

    expect(primo).toMatchObject({ ok: true, daRiprovare: 1 });
    expect(stato.stripe.creati).toEqual([]);
    const avvisi = avvisiAgliAmministratori().filter((a) => a.includes('prenotato da un giro di prima'));
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0]).toContain('#O1');
    expect(avvisi[0]).toContain('anche se nel frattempo l\'ordine viene accettato o annullato');
    expect(o1().delivery_slot).toBe(ETICHETTA_ADESSO);
  });

  it('senza la migrazione 412 la tabella non c è: il secondo giro non fa niente e non avvisa nessuno', async () => {
    await giroCheMuorePrimaDiStripe();
    Object.assign(o1(), { delivery_status: 'ACCEPTED' });
    stato.senzaTabella = true;

    const esito = await giro('2026-10-30T17:31:00.000Z');

    expect(esito).toMatchObject({ ok: true, euroRipresi: 0 });
    expect(stato.stripe.creati).toEqual([]);
    expect(avvisiAgliAmministratori()).toEqual([]);
  });
});
