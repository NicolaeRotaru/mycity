import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/11/2026 (R06-008) — IL DOPPIO TOCCO SULL'ANNULLO CON LA CARTA NON È UN RIMBORSO FALLITO.
 *
 * Due tocchi su «Annulla» (o «Rifiuta») di un ordine pagato con la carta: il primo prenota il
 * rimborso, il secondo trova il tetto pieno e `refundOrder` lancia. Il secondo rispondeva «rimborso
 * fallito» a chi aveva toccato e, in un carrello di più negozi, la sua `rimetti` trovava la riga
 * cambiata dal primo e mandava agli amministratori un falso «Carrello da sistemare a mano».
 *
 * Se diventa rosso: il secondo annullo torna a dire RIMBORSO_FALLITO, o torna l'avviso falso, o un
 * rimborso caduto davvero viene scambiato per un doppio tocco.
 *
 * Il database finto applica davvero filtri e scritture (tests/unit/carrello-finto.ts). Il rimborso
 * finto fa quello che conta di `refundOrder`: legge il rimborsato, prenota con il tetto dentro (come
 * `accumula_rimborso`), poi «Stripe» e, se il rimborso è pieno, l'ordine annullato.
 */

const avvisi: string[] = [];
const stripe: Array<{ orderId: string; cents: number }> = [];
let primaDiStripe: () => Promise<void> = async () => undefined;

const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  const r = riga(a.orderId);
  const lordo = Number(r.gross_total_cents);
  const quanto = Math.min(a.amountCents, lordo - Number(r.refunded_amount_cents ?? 0));
  if (quanto <= 0) throw new Error('refundOrder: importo rimborso non valido');
  await primaDiStripe();
  // La prenotazione: una riga sola, col tetto dentro.
  const gia = Number(r.refunded_amount_cents ?? 0);
  if (gia + quanto > lordo) throw new Error('refundOrder: rimborso già registrato o oltre il totale dell ordine');
  r.refunded_amount_cents = gia + quanto;
  await inVolo();
  stripe.push({ orderId: a.orderId, cents: quanto });
  if (gia + quanto >= lordo) Object.assign(r, { payment_status: 'REFUNDED', delivery_status: 'CANCELED', canceled_at: '2026-11-27T10:00:00Z' });
  return { refundId: `re_${stripe.length}`, importoCents: quanto };
});
let inVolo: () => Promise<void> = async () => undefined;

vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async (titolo: string) => { avvisi.push(titolo); }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { finto, carrello } from './carrello-finto';

const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
/** Quello che la rotta ha letto prima di chiamare l'annullo: una copia, non la riga. */
const letto = (id: string) => ({ ...riga(id) }) as never;

beforeEach(() => {
  avvisi.length = 0;
  stripe.length = 0;
  primaDiStripe = async () => undefined;
  inVolo = async () => undefined;
  refundOrder.mockClear();
});

describe('doppio tocco sull annullo di un ordine pagato con la carta', () => {
  it('un negozio solo, il secondo tocco arriva a primo finito: «già annullato», non «rimborso fallito»', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'card') });
    const primaLettura = letto('pane');
    const secondaLettura = letto('pane');

    const primo = await annullaERimborsa(db as never, primaLettura, { reason: 'Annullato dal cliente' });
    const secondo = await annullaERimborsa(db as never, secondaLettura, { reason: 'Annullato dal cliente' });

    expect(primo).toMatchObject({ ok: true });
    expect(secondo).toEqual({ ok: false, motivo: 'GIA_ANNULLATO' });
    expect(stripe, 'un solo rimborso').toEqual([{ orderId: 'pane', cents: 1800 }]);
    expect(avvisi).toEqual([]);
  });

  it('carrello di due negozi, il secondo tocco scrive il suo segno prima che il primo prenoti: niente falso «Carrello da sistemare a mano»', async () => {
    db = finto({ orders: carrello(['pane', 'frutta'], [1500, 1200], 'card') });
    const primaLettura = letto('pane');
    const secondaLettura = letto('pane');

    // Il primo arriva al rimborso e aspetta; il secondo fa il giro (segno col rimborsato letto prima),
    // poi il primo prenota e resta «in volo» su Stripe mentre il secondo prova a prenotare.
    let liberaIlPrimo: () => void = () => undefined;
    const ilSecondoEArrivato = new Promise<void>((ok) => { liberaIlPrimo = ok; });
    let liberaStripe: () => void = () => undefined;
    const stripeRisponde = new Promise<void>((ok) => { liberaStripe = ok; });
    let chiamata = 0;
    primaDiStripe = async () => {
      chiamata++;
      if (chiamata === 1) return ilSecondoEArrivato;
      liberaIlPrimo();
      await new Promise((ok) => setTimeout(ok, 0));
    };
    inVolo = () => stripeRisponde;

    const primo = annullaERimborsa(db as never, primaLettura, { reason: 'Rifiutato dal negozio' });
    await vi.waitFor(() => expect(refundOrder).toHaveBeenCalledTimes(1));
    const secondo = await annullaERimborsa(db as never, secondaLettura, { reason: 'Rifiutato dal negozio' });
    // Se il secondo se n'è andato prima del rimborso (il turno era già preso), il primo va avanti lo stesso.
    liberaIlPrimo();
    liberaStripe();
    const esitoPrimo = await primo;

    expect(esitoPrimo).toMatchObject({ ok: true });
    expect(secondo).toEqual({ ok: false, motivo: 'GIA_ANNULLATO' });
    expect(avvisi, 'avviso falso agli amministratori').not.toContain('⚠️ Carrello da sistemare a mano');
    expect(stripe.map((s) => s.orderId), 'un solo rimborso del pane').toEqual(['pane']);
    // Il carrello resta quello su cui il primo ha reso: il pane se ne va con 16 €, la frutta prende i 3 € di consegna.
    expect(stripe[0].cents).toBe(1600);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, total_price: 15 });
  });

  it('un rimborso caduto davvero resta «rimborso fallito», e il carrello torna com era', async () => {
    db = finto({ orders: carrello(['pane', 'frutta'], [1500, 1200], 'card') });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe 503'); });

    const esito = await annullaERimborsa(db as never, letto('pane'), { reason: 'Rifiutato dal negozio' });

    expect(esito).toEqual({ ok: false, motivo: 'RIMBORSO_FALLITO', dettaglio: 'Stripe 503' });
    expect(riga('pane')).toMatchObject({ delivery_status: 'NEW', delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 18 });
  });

  it('un reso parziale arrivato in mezzo non è un altro annullo: il rimborso è fallito davvero', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'card') });
    const lettura = letto('pane');
    refundOrder.mockImplementationOnce(async (a: { orderId: string }) => {
      riga(a.orderId).refunded_amount_cents = 500;
      throw new Error('refundOrder: rimborso già registrato o oltre il totale dell ordine');
    });

    const esito = await annullaERimborsa(db as never, lettura, { reason: 'Annullato dal cliente' });

    expect(esito).toMatchObject({ ok: false, motivo: 'RIMBORSO_FALLITO' });
  });
});
