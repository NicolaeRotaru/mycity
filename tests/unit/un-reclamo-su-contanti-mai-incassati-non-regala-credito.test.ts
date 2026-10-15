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

function apri(ordine: Riga) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    disputes: [{ id: 'd1', status: 'open', order_id: 'o1', opener_id: 'cliente', against_id: 'negozio' }],
    profiles: [{ id: 'nicola', role: 'admin' }],
    notifications: [],
  });
}

const NOTE = 'Il fattorino non è mai arrivato: chiudiamo a favore del cliente.';

function chiudiAFavoreDelCliente(refundCents: number) {
  const req = new Request('http://localhost/api/admin/disputes/d1/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'resolved_buyer', notes: NOTE, refundCents }),
  });
  return risolvi(req as never, { params: Promise.resolve({ id: 'd1' }) });
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

  it('se il cliente aveva speso credito MyCity, si restituisce solo quello', async () => {
    apri(maiArrivato({ total_price: 19, wallet_applied_cents: 500 }));

    const troppo = await chiudiAFavoreDelCliente(2400);
    expect(troppo.status).toBe(400);
    expect((await troppo.json()).error.message).toContain('5.00 €');

    const giusto = await chiudiAFavoreDelCliente(500);
    expect(giusto.status).toBe(200);
    expect(creditoDi(finto.db, 'cliente')).toBe(500);
    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare'), 'il credito speso non va mai col bonifico').toHaveLength(0);
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
    expect(avviso.link).toBe('/admin/disputes');
  });
});
