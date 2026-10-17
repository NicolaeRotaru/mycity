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
  it('il reclamo chiuso a favore del cliente rimborsa, scrive il bonifico sull ordine e avvisa chi lo paga', async () => {
    apri(maiArrivato({ delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z' }));

    const res = await chiudiAFavoreDelCliente(2400);

    expect(res.status).toBe(200);
    expect(reclamo().status).toBe('resolved_buyer');
    expect(ordine()).toMatchObject({
      payment_status: 'REFUNDED', refunded_amount_cents: 2400, stripe_refund_id: 'bonifico:2400:dispute_d1',
    });
    expect(creditoDi(finto.db, 'cliente'), 'R71: i contanti non tornano come credito').toBe(0);
    const avvisi = notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0].link).toBe('/admin/orders');
    expect(String(avvisi[0].body)).toContain(`Bonifico di ${formatPriceFromCents(2400)}`);
    expect(String(avvisi[0].body)).toContain('«Rimborso MyCity ordine #O1 reclamo D1»');
  });

  /**
   * Collaudo del 15/10, secondo giro — il bonifico del reclamo diceva l'importo giusto solo perche'
   * l'ordine della prova non aveva credito. Ordine da 50 €: 20 di credito, 30 in contanti incassati.
   */
  it('ordine pagato in parte col credito: il bonifico e solo la parte dei contanti, non l intero rimborso', async () => {
    apri(maiArrivato({
      total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500,
      delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z',
    }));

    const res = await chiudiAFavoreDelCliente(5000);

    expect(res.status).toBe(200);
    expect(creditoDi(finto.db, 'cliente'), 'la parte pagata col credito torna credito').toBe(2000);
    expect(ordine().stripe_refund_id).toBe('bonifico:3000:dispute_d1');
    const testo = String(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare')[0].body);
    expect(testo, 'chi paga bonificherebbe anche i 20 € gia tornati come credito').toContain(`Bonifico di ${formatPriceFromCents(3000)}`);
  });

  it('nessuna tabella dei bonifici: la rotta non scrive niente fuori dall ordine', async () => {
    apri(maiArrivato({ delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z' }));

    await chiudiAFavoreDelCliente(2400);

    expect(finto.db.scritture.filter((w) => w.tabella === 'bonifici_dei_reclami')).toHaveLength(0);
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
