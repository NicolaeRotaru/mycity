import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 28/11/2026 (onda 2, R06-008) — IL SECONDO TOCCO SULL'ANNULLO CON LA CARTA NON RIFÀ IL CARRELLO.
 *
 * Il primo giro di riparazione aveva tolto il falso «rimborso fallito» e il falso «Carrello da sistemare
 * a mano», ma il secondo tocco passava ancora da `ricalcolaLaConsegnaDelGiro` PRIMA del rimborso: scriveva
 * di nuovo sul carrello appena rifatto dal primo, e nessuna prova fissava che quella scrittura desse gli
 * stessi valori. Col turno preso prima del giro (R06-011) il secondo tocco se ne va subito: GIA_ANNULLATO,
 * nessuna scrittura sul carrello, nessuna chiamata al rimborso, e il carrello resta esattamente quello del
 * primo annullo.
 *
 * Se diventa rosso: il secondo tocco torna a scrivere sul carrello o a chiamare il rimborso.
 */

const avvisi: string[] = [];
const stripe: Array<{ orderId: string; cents: number }> = [];
let inVolo: () => Promise<void> = async () => undefined;

const refundOrder = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  const r = riga(a.orderId);
  const lordo = Number(r.gross_total_cents);
  const quanto = Math.min(a.amountCents, lordo - Number(r.refunded_amount_cents ?? 0));
  if (quanto <= 0) throw new Error('refundOrder: importo rimborso non valido');
  const gia = Number(r.refunded_amount_cents ?? 0);
  if (gia + quanto > lordo) throw new Error('refundOrder: rimborso già registrato o oltre il totale dell ordine');
  r.refunded_amount_cents = gia + quanto;
  await inVolo();
  stripe.push({ orderId: a.orderId, cents: quanto });
  if (gia + quanto >= lordo) Object.assign(r, { payment_status: 'REFUNDED', delivery_status: 'CANCELED', canceled_at: '2026-11-28T10:00:00Z' });
  return { refundId: `re_${stripe.length}`, importoCents: quanto };
});

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
const letto = (id: string) => ({ ...riga(id) }) as never;

/** Ogni scrittura sulla tabella degli ordini, con chi la fa (`chi.adesso`) e le righe toccate. */
function conScrittureContate() {
  const chi = { adesso: 'nessuno' };
  const scritture: Array<{ chi: string; valori: Record<string, unknown> }> = [];
  const vero = db.from;
  db.from = ((t: string) => {
    const q = vero(t) as Record<string, unknown>;
    const update = q.update as (v: Record<string, unknown>) => unknown;
    q.update = (v: Record<string, unknown>) => {
      if (t === 'orders') scritture.push({ chi: chi.adesso, valori: v });
      return update(v);
    };
    return q;
  }) as typeof db.from;
  // Il giro scritto in una transazione (620) passa da qui: anche quella è una scrittura sul carrello.
  const rpcVera = db.rpc;
  db.rpc = (async (nome: string, args: unknown) => {
    if (nome === 'sposta_la_consegna_nel_carrello') scritture.push({ chi: chi.adesso, valori: { rpc: nome } });
    return (rpcVera as (n: string, a: unknown) => Promise<unknown>)(nome, args);
  }) as typeof db.rpc;
  return { chi, scritture };
}

beforeEach(() => {
  avvisi.length = 0;
  stripe.length = 0;
  inVolo = async () => undefined;
  refundOrder.mockClear();
});

describe('R06-008 — il secondo tocco non rifà il carrello', () => {
  it('carrello di due negozi, il secondo tocco arriva mentre il primo è da Stripe: nessuna scrittura sul carrello, nessun rimborso', async () => {
    db = finto({ orders: carrello(['pane', 'frutta'], [1500, 1200], 'card') });
    const { chi, scritture } = conScrittureContate();
    const primaLettura = letto('pane');
    const secondaLettura = letto('pane');

    let liberaStripe: () => void = () => undefined;
    inVolo = () => new Promise<void>((ok) => { liberaStripe = ok; });
    chi.adesso = 'primo';
    const primo = annullaERimborsa(db as never, primaLettura, { reason: 'Rifiutato dal negozio' });
    await vi.waitFor(() => expect(refundOrder).toHaveBeenCalledTimes(1));
    const carrelloDelPrimo = db.tabelle.orders.map((r) => ({ ...r }));

    chi.adesso = 'secondo';
    const secondo = await annullaERimborsa(db as never, secondaLettura, { reason: 'Rifiutato dal negozio' });
    const delSecondo = scritture.filter((s) => s.chi === 'secondo');
    const carrelloDopoIlSecondo = db.tabelle.orders.map((r) => ({ ...r }));
    chi.adesso = 'primo';
    liberaStripe();
    const esitoPrimo = await primo;

    expect(esitoPrimo).toMatchObject({ ok: true });
    expect(secondo).toEqual({ ok: false, motivo: 'GIA_ANNULLATO' });
    expect(refundOrder, 'il secondo tocco ha chiamato il rimborso').toHaveBeenCalledTimes(1);
    // Il secondo prova solo a prendere il turno (CANCELED condizionato), e non lo trova.
    expect(delSecondo.map((s) => s.valori), 'il secondo tocco ha scritto sul carrello').toEqual([
      expect.objectContaining({ delivery_status: 'CANCELED' }),
    ]);
    expect(carrelloDopoIlSecondo, 'il secondo tocco ha cambiato il carrello del primo').toEqual(carrelloDelPrimo);
    expect(stripe).toEqual([{ orderId: 'pane', cents: 1600 }]);
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, total_price: 15 });
    expect(avvisi).toEqual([]);
  });
});
