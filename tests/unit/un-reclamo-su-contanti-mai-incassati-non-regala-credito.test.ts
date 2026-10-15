import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R84 — UN RECLAMO CHIUSO A FAVORE DEL CLIENTE SU UN ORDINE IN CONTANTI MAI
 * PAGATO GLI REGALAVA CREDITO MYCITY.
 *
 * Il caso della scheda: un cliente ordina in contanti per 24 €, il fattorino
 * non arriva, nessuno incassa niente. Il cliente apre un reclamo «mai
 * arrivato». Dal pannello dei reclami non si vede che l'ordine era in contanti
 * e non pagato: c'e' solo un campo «Rimborso (€)». Si sceglie «a favore del
 * cliente» e si scrive 24. `refundOrder` non guardava se i contanti fossero
 * arrivati: 24 € di credito spendibile, nati dal nulla, e la quota del negozio
 * segnata come ripresa.
 *
 * Gira la rotta VERA dei reclami con la `refundOrder` VERA; finti solo il
 * database, l'autenticazione dell'amministratore, Stripe e la posta.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: 'nicola' }, req, params: (await ctx?.params) ?? {} }),
}));

import { refundOrder, RimborsoNonRitentabile } from '@/lib/stripe/payout';
import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';
import { POST as annullaDaAmministratore } from '@/app/api/admin/orders/[id]/cancel/route';
import { PAGINA_DEI_BONIFICI_DA_FARE } from '@/lib/rimborsi/scelta-del-reso';
import { pagamentoPerChiDecide } from '@/lib/rimborsi/regole-del-rimborso';
import { formatPriceFromCents } from '@/lib/format';

/** 24 € in contanti, il fattorino non e' mai arrivato: nessuno ha incassato niente. */
function maiArrivato(extra: Riga = {}): Riga {
  return {
    id: 'o1', user_id: 'cliente', seller_id: 'negozio',
    total_price: 24, gross_total_cents: 2400, wallet_applied_cents: 0,
    seller_payout_cents: 2160, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: 'rider', rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 300, shipping_cost: 3,
    delivery_status: 'OUT_FOR_DELIVERY', payment_status: 'PENDING', cash_confirmed_at: null,
    ...extra,
  };
}

function apri(ordine: Riga, altriReclami: Riga[] = []) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    disputes: [{ id: 'd1', status: 'open', order_id: 'o1', opener_id: 'cliente', against_id: 'negozio' }, ...altriReclami],
    profiles: [{ id: 'nicola', role: 'admin' }],
    notifications: [],
  });
}

const NOTE = 'Il fattorino non è mai arrivato: chiudiamo a favore del cliente.';

function chiudiAFavoreDelCliente(refundCents: number, reclamo = 'd1') {
  const req = new Request(`http://localhost/api/admin/disputes/${reclamo}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'resolved_buyer', notes: NOTE, refundCents }),
  });
  return risolvi(req as never, { params: Promise.resolve({ id: reclamo }) });
}

/** L'amministratore annulla l'ordine fermo, dalla rotta vera (che usa annullaERimborsa vera). */
function annullaLOrdine() {
  const req = new Request('http://localhost/api/admin/orders/o1/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Ordine fermo: il fattorino non è mai arrivato' }),
  });
  return annullaDaAmministratore(req as never, { params: Promise.resolve({ id: 'o1' }) });
}

const ordine = () => finto.db.tabelle.orders[0];
const reclamo = () => finto.db.tabelle.disputes[0];

beforeEach(() => apri(maiArrivato()));

describe('contanti mai incassati: niente da restituire', () => {
  it('IL CASO CHE ROMPEVA — il reclamo non crea credito dal nulla', async () => {
    const res = await chiudiAFavoreDelCliente(2400);

    expect(creditoDi(finto.db, 'cliente'), '24 € di credito per una cosa che nessuno ha pagato').toBe(0);
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(corpo.error.message).toContain('non è stato incassato niente');
  });

  it('chi decide legge il perché, e il reclamo resta aperto: niente quota del negozio ripresa', async () => {
    await chiudiAFavoreDelCliente(2400);

    expect(reclamo().status, 'il reclamo e stato chiuso senza poter emettere il rimborso').toBe('open');
    expect(ordine().refunded_amount_cents).toBe(0);
    expect(ordine().seller_payout_reversed_cents, 'al negozio e stata tolta una quota mai incassata').toBe(0);
  });

  it('anche chiamata da un altra strada, refundOrder rifiuta senza prenotare niente', async () => {
    const tentativo = refundOrder({ orderId: 'o1', amountCents: 2400, idempotencyKey: 'dispute_d1' });

    await expect(tentativo).rejects.toBeInstanceOf(RimborsoNonRitentabile);
    expect(finto.db.rpc.map((c) => c.nome)).not.toContain('accumula_rimborso');
    expect(finto.db.rpc.map((c) => c.nome)).not.toContain('wallet_credit');
  });

  it('se il cliente aveva speso credito MyCity, il reclamo non lo restituisce: manda ad annullare', async () => {
    apri(maiArrivato({ total_price: 19, wallet_applied_cents: 500 }));

    const res = await chiudiAFavoreDelCliente(500);

    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain('annullalo');
    expect(creditoDi(finto.db, 'cliente')).toBe(0);
    expect(reclamo().status).toBe('open');
  });

  it('su un ordine annullato il credito l ha gia restituito l annullo: niente seconda volta', async () => {
    apri(maiArrivato({ total_price: 19, wallet_applied_cents: 500, delivery_status: 'CANCELED', payment_status: 'FAILED' }));

    const res = await chiudiAFavoreDelCliente(500);

    expect(res.status).toBe(409);
    expect(creditoDi(finto.db, 'cliente')).toBe(0);
  });
});

describe('contanti incassati: il rimborso esce, e col bonifico', () => {
  it('il reclamo chiuso a favore del cliente rimborsa e avvisa chi deve fare il bonifico', async () => {
    apri(maiArrivato({ delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z' }));

    const res = await chiudiAFavoreDelCliente(2400);

    expect(res.status).toBe(200);
    expect(reclamo().status).toBe('resolved_buyer');
    expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', refunded_amount_cents: 2400 });
    expect(creditoDi(finto.db, 'cliente'), 'R71: nessuno ha scelto il credito').toBe(0);
    const [avviso] = notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
    expect(avviso.link).toBe(PAGINA_DEI_BONIFICI_DA_FARE);
  });

  it('il bonifico del reclamo resta scritto nella lista dei bonifici, non solo nell avviso', async () => {
    apri(maiArrivato({ delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z' }));

    await chiudiAFavoreDelCliente(2400);

    expect(finto.db.tabelle.bonifici_dei_reclami, 'il bonifico promesso vive solo nella campanella').toEqual([
      expect.objectContaining({ dispute_id: 'd1', order_id: 'o1', importo_cents: 2400 }),
    ]);
  });

  it('senza la migrazione 162 il reclamo si chiude lo stesso, e resta l avviso', async () => {
    apri(maiArrivato({ delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z' }));
    finto.db.guasti.tabelleMancanti = ['bonifici_dei_reclami'];

    const res = await chiudiAFavoreDelCliente(2400);

    expect(res.status).toBe(200);
    expect(reclamo().status).toBe('resolved_buyer');
    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare')).toHaveLength(1);
  });
});

/**
 * Collaudo del 15/10 — IL CREDITO TORNAVA DUE VOLTE.
 *
 * Il caso del collaudatore: un ordine in contanti da 24 €, pagato 10 col credito
 * MyCity, accettato dal negozio e mai consegnato. Due mosse normali di un
 * amministratore onesto: chiude il reclamo con l'importo massimo che il
 * pannello gli mostra (i 10 € di credito), poi annulla l'ordine fermo. L'annullo
 * restituisce `wallet_applied_cents` senza sapere del reclamo: 20 € di credito
 * per 10 spesi. Gira la rotta vera dei reclami, la `refundOrder` vera e la
 * rotta vera dell'annullo (con `annullaERimborsa` vera).
 */
describe('il credito di un ordine fermo torna una volta sola', () => {
  const fermo = () => maiArrivato({ total_price: 14, wallet_applied_cents: 1000, delivery_status: 'ACCEPTED' });

  it('IL CASO DEL COLLAUDO — reclamo e poi annullo: 10 € spesi, 10 € tornati', async () => {
    apri(fermo());

    const pannello = pagamentoPerChiDecide(ordine());
    expect(pannello.massimoCents, 'il pannello indica come rimborsabile un credito che l annullo ridara').toBe(0);

    const reclamoChiuso = await chiudiAFavoreDelCliente(1000);
    expect(reclamoChiuso.status).toBe(409);
    expect((await reclamoChiuso.json()).error.message).toContain('annullalo');

    const annullo = await annullaLOrdine();
    expect(annullo.status).toBe(200);

    expect(creditoDi(finto.db, 'cliente'), `diario del credito: ${JSON.stringify(finto.db.diarioCredito)}`).toBe(1000);
    expect(ordine().seller_payout_reversed_cents, 'al negozio e stata tolta una quota mai incassata').toBe(0);
  });

  it('annullo e poi reclamo: il reclamo non ridà niente', async () => {
    apri(fermo());

    expect((await annullaLOrdine()).status).toBe(200);
    expect(creditoDi(finto.db, 'cliente')).toBe(1000);

    const res = await chiudiAFavoreDelCliente(1000);
    expect(res.status).toBe(409);
    expect(creditoDi(finto.db, 'cliente')).toBe(1000);
  });

  it('un ordine rimborsato in parte prima di questo lotto non diventa «incassato»: il secondo reclamo si ferma', async () => {
    // Un reclamo di prima del lotto aveva gia' restituito i 10 € di credito su
    // quest'ordine fermo, lasciandolo PARTIALLY_REFUNDED. Il collaudatore: il
    // pannello lo diceva «incassati», rimborsabile 14 €, e un secondo reclamo
    // restituiva 14 € di contanti mai versati.
    apri(
      maiArrivato({
        total_price: 14, wallet_applied_cents: 1000, delivery_status: 'ACCEPTED',
        payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000,
      }),
      [{ id: 'd2', status: 'open', order_id: 'o1', opener_id: 'cliente', against_id: 'negozio' }],
    );
    finto.db.tabelle.disputes[0].status = 'resolved_buyer';

    const pannello = pagamentoPerChiDecide(ordine());
    expect(pannello.comeHaPagato).toContain('NON incassati');
    expect(pannello.comeHaPagato).toContain(formatPriceFromCents(1000));

    const res = await chiudiAFavoreDelCliente(1400, 'd2');
    expect(res.status).toBe(409);
    expect(creditoDi(finto.db, 'cliente')).toBe(0);
    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare')).toHaveLength(0);
  });
});
