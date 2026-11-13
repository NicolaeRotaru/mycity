import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaLibro, creaStripe, ordineConCarta, type Libro, type StripeFinto } from './aiuti/libro-dei-rimborsi-r17';

/**
 * R17-014 — Due rimborsi dello stesso reso lanciati nello stesso istante si contavano due volte.
 *
 * Ordine con la carta da 40 €, bonifico al negozio già partito (36 € di sua parte). Il negozio
 * approva il reso con 20 € di rimborso, chiave `return_r1`, e la richiesta parte due volte
 * insieme. Prima: tutte e due guardavano Stripe (niente ancora), tutte e due prenotavano 20 €,
 * Stripe con la stessa chiave rimborsava una volta sola, e il libro dell'ordine diceva 40 € su
 * 20 € usciti, con 36 € tolti al negozio invece di 18. Adesso la prenotazione porta la chiave
 * (migrazione 412): la seconda richiesta trova quella della prima e si ferma, senza toccare niente.
 * E un tentativo morto fra la prenotazione e Stripe non conta due volte quando un altro lo riprende.
 */

const stato: { libro: Libro; stripe: StripeFinto } = { libro: creaLibro({}), stripe: creaStripe() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stato.stripe.client() }));

import { refundOrder } from '@/lib/stripe/payout';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const reso = () =>
  refundOrder({ orderId: 'o1', amountCents: 2000, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });
const sommaStorni = () => stato.stripe.storni.reduce((s, x) => s + x.amount, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
  stato.stripe = creaStripe();
  stato.libro = creaLibro({
    orders: [ordineConCarta()],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller' }],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-014 · lo stesso reso lanciato due volte insieme', () => {
  it('la seconda richiesta parte mentre la prima rimborsa: 20 € nel libro, non 40, e al negozio si tolgono 18 €', async () => {
    // La prima è dentro la chiamata a Stripe; la seconda guarda Stripe in quel momento (niente
    // ancora) e la risposta le arriva quando la prima ha finito.
    let apriLaCreazione!: () => void;
    let apriLElenco!: () => void;
    stato.stripe.createLenta = new Promise<void>((r) => { apriLaCreazione = r; });
    const prima = reso();
    await vi.waitFor(() => expect(stato.stripe.createLenta).toBeNull());
    stato.stripe.listLenta = new Promise<void>((r) => { apriLElenco = r; });
    const seconda = reso();
    await vi.waitFor(() => expect(stato.stripe.listLenta).toBeNull());
    apriLaCreazione();
    await prima;
    apriLElenco();
    const esitoSeconda = await seconda.then(
      () => 'finita',
      (e: Error & { ritentabile?: boolean }) => (e.ritentabile === false ? 'non si riprova' : e.message),
    );

    expect(stato.stripe.creati).toEqual([2000]);
    expect(ordine().refunded_amount_cents).toBe(2000);
    expect(sommaStorni()).toBe(1800);
    expect(esitoSeconda).toMatch(/in corso.*riprova/);
  });

  it('chi riprova dopo trova il rimborso della prima: niente di nuovo, né nel libro né al negozio', async () => {
    await reso();
    vi.setSystemTime(new Date('2026-11-13T10:30:00.000Z'));
    const esito = await reso();
    expect(esito.refundId).toBe('re_1');
    expect(stato.stripe.creati).toEqual([2000]);
    expect(ordine().refunded_amount_cents).toBe(2000);
    expect(sommaStorni()).toBe(1800);
  });

  it('il tentativo muore fra la prenotazione e Stripe: chi lo riprende dopo 10 minuti rimborsa una volta e conta una volta', async () => {
    stato.stripe.createMuore = true;
    void reso();
    await vi.waitFor(() => expect(ordine().refunded_amount_cents).toBe(2000));
    // Dentro i 10 minuti la prenotazione è di chi l'ha presa: si aspetta, non si tocca.
    vi.setSystemTime(new Date('2026-11-13T10:05:00.000Z'));
    await expect(reso()).rejects.toThrow(/in corso.*riprova/);
    expect(ordine().refunded_amount_cents).toBe(2000);
    // Passati i 10 minuti quel tentativo è morto: questo finisce il lavoro.
    vi.setSystemTime(new Date('2026-11-13T10:11:00.000Z'));
    const esito = await reso();
    expect(esito.refundId).toBe('re_1');
    expect(stato.stripe.creati).toEqual([2000]);
    expect(ordine().refunded_amount_cents).toBe(2000);
    expect(sommaStorni()).toBe(1800);
  });

  it('Stripe dice di no: la prenotazione di questa chiave torna indietro, e il nuovo tentativo prenota da capo', async () => {
    stato.stripe.createRifiutata = true;
    await expect(reso()).rejects.toThrow('declined');
    expect(ordine().refunded_amount_cents).toBe(0);
    expect(stato.libro.prenotazioni).toEqual([]);
    const esito = await reso();
    expect(esito.refundId).toBe('re_1');
    expect(ordine().refunded_amount_cents).toBe(2000);
    expect(stato.stripe.creati).toEqual([2000]);
  });

  it('sul database senza la 412 il rimborso parte lo stesso, prenotato senza chiave come prima', async () => {
    stato.libro.senza412 = true;
    const esito = await reso();
    expect(esito.refundId).toBe('re_1');
    expect(ordine().refunded_amount_cents).toBe(2000);
    expect(stato.libro.db.rpc.filter((c) => c.nome === 'accumula_rimborso').map((c) => 'p_chiave' in c.argomenti))
      .toEqual([true, false]);
  });
});
