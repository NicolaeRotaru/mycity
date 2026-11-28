import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 28/11/2026 (onda 2, R06-011) — SUL RAMO CARTA L'ANNULLO PRENDE IL TURNO PRIMA DEL GIRO E DEL RIMBORSO.
 *
 * Sui contanti il turno è la scrittura di CANCELED condizionata sullo stato che il chiamante ha letto
 * (lib/ordini/annulla.ts, R131). Sulla carta no: due annulli da strade diverse (il cliente e il negozio)
 * passavano tutti e due, rifacevano il giro del carrello e chiamavano il rimborso; un annullo partito
 * da uno stato già cambiato (il negozio ha accettato nel frattempo) rimborsava lo stesso; e con un
 * rimborso parziale di prima la merce non tornava a scaffale (refundOrder leggeva «già chiuso da un
 * rimborso»). Adesso: CANCELED prima, condizionato; se il rimborso cade l'ordine torna com'era; e se non
 * torna, gli amministratori lo sanno.
 *
 * Se diventa rosso: il secondo annullo torna a toccare carrello e rimborso, un annullo su uno stato
 * cambiato rimborsa, l'ordine resta annullato dopo un rimborso caduto, o un consegnato viene annullato.
 *
 * Il database finto applica davvero filtri e scritture (tests/unit/carrello-finto.ts). Il rimborso finto
 * fa quello che conta di `refundOrder`: legge il rimborsato, prenota col tetto dentro, «Stripe», e se il
 * rimborso è pieno scrive l'ordine annullato (non su un consegnato, 054).
 */

const avvisi: string[] = [];
const stripe: Array<{ orderId: string; cents: number }> = [];
let inVolo: () => Promise<void> = async () => undefined;

type Chiesto = { orderId: string; amountCents: number; annullatoDaChiChiama?: boolean };
const refundOrder = vi.fn(async (a: Chiesto) => {
  const r = riga(a.orderId);
  const lordo = Number(r.gross_total_cents);
  const quanto = Math.min(a.amountCents, lordo - Number(r.refunded_amount_cents ?? 0));
  if (quanto <= 0) throw new Error('refundOrder: importo rimborso non valido');
  const gia = Number(r.refunded_amount_cents ?? 0);
  if (gia + quanto > lordo) throw new Error('refundOrder: rimborso già registrato o oltre il totale dell ordine');
  r.refunded_amount_cents = gia + quanto;
  await inVolo();
  stripe.push({ orderId: a.orderId, cents: quanto });
  if (gia + quanto >= lordo) {
    Object.assign(r, { payment_status: 'REFUNDED' });
    if (r.delivery_status !== 'DELIVERED') Object.assign(r, { delivery_status: 'CANCELED', canceled_at: '2026-11-28T10:00:00Z' });
  }
  return { refundId: `re_${stripe.length}`, importoCents: quanto };
});

vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: Chiesto) => refundOrder(a) }));
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

/** Le chiamate rpc del database finto (il credito MyCity, la merce a scaffale): per contarle. */
function conRpcContate() {
  const chiamate: Array<{ nome: string; args: Record<string, unknown> }> = [];
  db.rpc = (async (nome: string, args: Record<string, unknown>) => {
    chiamate.push({ nome, args });
    return { data: null, error: null };
  }) as typeof db.rpc;
  return chiamate;
}

beforeEach(() => {
  avvisi.length = 0;
  stripe.length = 0;
  inVolo = async () => undefined;
  refundOrder.mockClear();
});

describe('R06-011 — sul ramo carta l annullo prende il turno prima del giro e del rimborso', () => {
  it('il cliente annulla e il negozio rifiuta insieme (carta + credito): un solo rimborso, un solo credito, il secondo non tocca niente', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'card').map((r) => ({ ...r, wallet_applied_cents: 2000 })) });
    const rpc = conRpcContate();
    const letturaDelCliente = letto('pane');
    const letturaDelNegozio = letto('pane');

    let liberaStripe: () => void = () => undefined;
    inVolo = () => new Promise<void>((ok) => { liberaStripe = ok; });
    const delCliente = annullaERimborsa(db as never, letturaDelCliente, { reason: 'Annullato dal cliente', motivoCredito: 'order_canceled' });
    await vi.waitFor(() => expect(refundOrder).toHaveBeenCalledTimes(1));
    const delNegozio = await annullaERimborsa(db as never, letturaDelNegozio, { reason: 'Rifiutato dal negozio', motivoCredito: 'order_seller_rejected' });
    liberaStripe();
    const esitoDelCliente = await delCliente;

    expect(esitoDelCliente).toMatchObject({ ok: true });
    expect(delNegozio).toEqual({ ok: false, motivo: 'GIA_ANNULLATO' });
    expect(refundOrder, 'il secondo annullo ha chiamato di nuovo il rimborso').toHaveBeenCalledTimes(1);
    expect(stripe).toEqual([{ orderId: 'pane', cents: 1800 }]);
    const crediti = rpc.filter((c) => c.nome === 'wallet_credit');
    expect(crediti, 'il credito MyCity è tornato più di una volta').toHaveLength(1);
    expect(crediti[0].args).toMatchObject({ p_cents: 2000, p_reason: 'order_canceled' });
  });

  it('il negozio ha accettato fra la lettura e l annullo del cliente: nessun rimborso, l ordine resta accettato', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'card') });
    const letturaDelCliente = letto('pane'); // NEW
    riga('pane').delivery_status = 'ACCEPTED';

    const esito = await annullaERimborsa(db as never, letturaDelCliente, { reason: 'Annullato dal cliente' });

    expect(esito).toEqual({ ok: false, motivo: 'GIA_ANNULLATO' });
    expect(refundOrder, 'un annullo partito da uno stato già cambiato ha rimborsato').not.toHaveBeenCalled();
    expect(riga('pane')).toMatchObject({ delivery_status: 'ACCEPTED', refunded_amount_cents: 0 });
  });

  it('il rimborso dice che l annullo è di chi chiama: la merce torna a scaffale anche dopo un rimborso parziale di prima', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'card').map((r) => ({ ...r, refunded_amount_cents: 300, payment_status: 'PARTIALLY_REFUNDED' })) });

    const esito = await annullaERimborsa(db as never, letto('pane'), { reason: 'Annullato dal cliente' });

    expect(esito).toMatchObject({ ok: true });
    expect(refundOrder).toHaveBeenCalledTimes(1);
    expect(refundOrder.mock.calls[0][0]).toMatchObject({ orderId: 'pane', amountCents: 1500, annullatoDaChiChiama: true });
    // Il turno era preso prima del rimborso: quando il rimborso legge l'ordine, è già annullato da questo annullo.
    expect(riga('pane').delivery_status).toBe('CANCELED');
  });

  it('il rimborso cade: l ordine torna com era (stato e data di annullo), e si può riprovare', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'card').map((r) => ({ ...r, delivery_status: 'ACCEPTED', canceled_at: null })) });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe 503'); });

    const esito = await annullaERimborsa(db as never, letto('pane'), { reason: 'Rifiutato dal negozio' });

    expect(esito).toEqual({ ok: false, motivo: 'RIMBORSO_FALLITO', dettaglio: 'Stripe 503' });
    expect(riga('pane')).toMatchObject({ delivery_status: 'ACCEPTED', canceled_at: null, refunded_amount_cents: 0 });
    expect(avvisi).toEqual([]);

    const ancora = await annullaERimborsa(db as never, letto('pane'), { reason: 'Rifiutato dal negozio' });
    expect(ancora).toMatchObject({ ok: true });
    expect(stripe).toEqual([{ orderId: 'pane', cents: 1800 }]);
  });

  it('il rimborso cade e l ordine non torna com era: gli amministratori sanno che è annullato e NON rimborsato', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'card') });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe 503'); });
    // La scrittura che rimette l'ordine vivo cade.
    const vero = db.from;
    db.from = ((t: string) => {
      const q = vero(t) as Record<string, unknown>;
      const update = q.update as (v: Record<string, unknown>) => unknown;
      q.update = (v: Record<string, unknown>) => {
        if (t === 'orders' && v.delivery_status && v.delivery_status !== 'CANCELED') {
          const rotta: Record<string, unknown> = {};
          for (const k of ['eq', 'neq', 'select']) rotta[k] = () => rotta;
          rotta.then = (ok: (x: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'connessione persa' } }).then(ok);
          return rotta;
        }
        return update(v);
      };
      return q;
    }) as typeof db.from;

    const esito = await annullaERimborsa(db as never, letto('pane'), { reason: 'Annullato dal cliente' });

    expect(esito).toMatchObject({ ok: false, motivo: 'RIMBORSO_FALLITO' });
    expect(avvisi).toContain('Ordine annullato e NON rimborsato');
  });

  it('un ordine con la carta già consegnato (annullo dell amministrazione) non si scrive annullato: il turno non si prende', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'card').map((r) => ({ ...r, delivery_status: 'DELIVERED' })) });

    const esito = await annullaERimborsa(db as never, letto('pane'), { reason: 'Ordine annullato dall’amministrazione', merceNonTorna: true });

    expect(esito).toMatchObject({ ok: true });
    expect(riga('pane').delivery_status).toBe('DELIVERED');
    expect(refundOrder.mock.calls[0][0]).not.toHaveProperty('annullatoDaChiChiama');
    expect(stripe).toEqual([{ orderId: 'pane', cents: 1800 }]);
  });
});
