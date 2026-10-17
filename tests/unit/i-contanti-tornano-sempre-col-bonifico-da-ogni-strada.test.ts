import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R71 — CHI HA PAGATO IN CONTANTI NON RICEVE MAI CREDITO MYCITY AL POSTO DEI SOLDI, DA NESSUNA STRADA.
 *
 * Decisione di Nicola del 17/10/2026 («Semplifica»): i contanti tornano sempre col bonifico, fatto
 * a mano da un amministratore. Prima la scelta stava nel modulo di reso (credito o bonifico), e la
 * leggevano tre rotte in tre modi: ogni strada era un posto dove il credito poteva rientrare. Adesso
 * non c'e' piu' niente da scegliere, e la prova passa da tutte le strade vere:
 *  · la pagina vecchia che manda ancora `rimborso: { modo: 'CREDITO' }` alla creazione del reso;
 *  · il negozio che approva il reso col rimborso (decide);
 *  · il negozio che segna il reso rimborsato dopo la merce ricevuta (avanza);
 *  · chi amministra che chiude un reclamo a favore del cliente (resolve);
 *  · `refundOrder` chiamata senza opzioni.
 * La parte pagata col credito MyCity torna credito (stesso mezzo), in proporzione.
 *
 * Girano le rotte VERE e la `refundOrder` VERA; finti il database, Stripe, l'autenticazione e la posta.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia' }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
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
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { refundOrder } from '@/lib/stripe/payout';
import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';
import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';
import { formatPriceFromCents } from '@/lib/format';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
const NUMERO = '#A1B2C3';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** 40 € pagati in contanti al fattorino, consegnato e incassato ieri. */
function inContanti(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
    ...extra,
  };
}

/** 50 €: 20 pagati col credito MyCity, 30 in contanti incassati. */
const misto = () => inContanti({ total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500 });

function apri(ordine: Riga) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    returns: [],
    order_items: [],
    disputes: [{ id: 'd1', status: 'open', order_id: ORDINE, opener_id: 'giulia', against_id: 'negozio' }],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
}

const ordine = () => finto.db.tabelle.orders[0];
const reclamo = () => finto.db.tabelle.disputes[0];
const accrediti = () => finto.db.rpc.filter((c) => c.nome === 'wallet_credit');
const avvisi = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');

/** Il reso aperto da una pagina VECCHIA, che manda ancora la scelta del credito. */
async function resoDallaPaginaVecchia(): Promise<string> {
  finto.utente = 'giulia';
  const res = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({
      orderId: ORDINE, reason: 'CHANGED_MIND', rimborso: { modo: 'CREDITO' },
    })),
    undefined,
  );
  expect(res.status, 'una pagina vecchia non riesce piu ad aprire un reso').toBe(201);
  return (await res.json()).id as string;
}

async function negozio(rotta: unknown, id: string, corpo: unknown) {
  finto.utente = 'negozio';
  const res = await (rotta as Rotta)(new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) });
  return { status: res.status, corpo: await res.json() };
}

async function chiudiIlReclamo(refundCents: number) {
  const res = await (risolvi as unknown as Rotta)(
    new Request('http://localhost/api/admin/disputes/d1/resolve', json({
      status: 'resolved_buyer', notes: 'Merce arrivata rotta: rimborso al cliente.', refundCents,
    })),
    { params: Promise.resolve({ id: 'd1' }) },
  );
  return { status: res.status, corpo: await res.json() };
}

/** Quello che deve essere vero dopo ogni strada, su un ordine tutto in contanti da 40 €. */
function soloBonifico(chiave: string) {
  expect(accrediti(), 'i contanti sono tornati come credito MyCity').toHaveLength(0);
  expect(creditoDi(finto.db, 'giulia')).toBe(0);
  expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', stripe_refund_id: `bonifico:4000:${chiave}` });
  expect(avvisi()).toHaveLength(1);
  const testo = String(avvisi()[0].body);
  expect(testo).toContain(`Bonifico di ${formatPriceFromCents(4000)}`);
  expect(testo).toContain(`dell'ordine ${NUMERO}`);
}

beforeEach(() => apri(inContanti()));

describe('da ogni strada, i contanti tornano col bonifico', () => {
  it('la pagina vecchia che chiede il credito apre il reso, e la scelta si scarta senza errore', async () => {
    await resoDallaPaginaVecchia();

    const inserito = finto.db.scritture.find((w) => w.tabella === 'returns' && w.tipo === 'insert')!;
    expect(inserito.valori, 'la scelta del cliente e entrata nel reso').not.toHaveProperty('refund_method');
    expect(Object.keys(inserito.valori).some((k) => /rimborso|refund_/u.test(k)), JSON.stringify(inserito.valori)).toBe(false);
  });

  it('decide: il negozio approva col rimborso → bonifico, mai credito', async () => {
    const id = await resoDallaPaginaVecchia();

    const deciso = await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 });

    expect(deciso.status, JSON.stringify(deciso.corpo)).toBe(200);
    soloBonifico(`return_${id}`);
    expect(finto.db.tabelle.returns[0]).toMatchObject({ status: 'REFUNDED', refund_id: `bonifico:4000:return_${id}` });
  });

  it('avanza: merce ricevuta, poi rimborsato → bonifico, mai credito', async () => {
    const id = await resoDallaPaginaVecchia();
    expect((await negozio(decidi, id, { decision: 'APPROVED' })).status).toBe(200);
    expect((await negozio(avanza, id, { stato: 'RECEIVED' })).status).toBe(200);

    const rimborsato = await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 4000 });

    expect(rimborsato.status, JSON.stringify(rimborsato.corpo)).toBe(200);
    soloBonifico(`return_${id}`);
  });

  it('resolve: il reclamo chiuso a favore del cliente → bonifico, mai credito', async () => {
    const chiuso = await chiudiIlReclamo(4000);

    expect(chiuso.status, JSON.stringify(chiuso.corpo)).toBe(200);
    soloBonifico('dispute_d1');
    expect(reclamo().status).toBe('resolved_buyer');
  });

  it('refundOrder chiamata senza nessuna opzione → bonifico, mai credito', async () => {
    const esito = await refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_altro' });

    expect(esito.refundId).toBe('bonifico:4000:return_altro');
    soloBonifico('return_altro');
  });
});

describe('ordine misto (20 € di credito, 30 in contanti): il credito torna credito, i contanti col bonifico', () => {
  beforeEach(() => apri(misto()));

  it('reso rimborsato per intero: 20 € di credito, un bonifico di 30 € e non di 50', async () => {
    const id = await resoDallaPaginaVecchia();

    expect((await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 5000 })).status).toBe(200);

    expect(accrediti()).toHaveLength(1);
    expect(accrediti()[0].args).toMatchObject({ p_user: 'giulia', p_cents: 2000, p_reason: 'cod_refund', p_ref: `return_${id}` });
    const testo = String(avvisi()[0].body);
    expect(testo).toContain(`Bonifico di ${formatPriceFromCents(3000)}`);
    expect(testo).not.toContain(formatPriceFromCents(5000));
  });

  it('reclamo per intero: stesso riparto, e il reclamo va LOST perche il cliente ha riavuto tutto', async () => {
    expect((await chiudiIlReclamo(5000)).status).toBe(200);

    expect(accrediti()[0].args).toMatchObject({ p_cents: 2000, p_reason: 'cod_refund' });
    expect(String(avvisi()[0].body)).toContain(`Bonifico di ${formatPriceFromCents(3000)}`);
    expect(ordine().internal_dispute_status).toBe('LOST');
  });

  it('reclamo di 30 €: 12 di credito e 18 col bonifico, e il reclamo va RESOLVED (il negozio riceve il resto)', async () => {
    expect((await chiudiIlReclamo(3000)).status).toBe(200);

    expect(accrediti()[0].args).toMatchObject({ p_cents: 1200 });
    expect(ordine().stripe_refund_id).toBe('bonifico:1800:dispute_d1');
    expect(String(avvisi()[0].body)).toContain(`Bonifico di ${formatPriceFromCents(1800)}`);
    expect(ordine().internal_dispute_status, 'R76: un rimborso non pieno toglie al negozio anche il resto').toBe('RESOLVED');
  });
});

describe('ordine pagato tutto col credito', () => {
  it('torna credito, e nessun avviso di bonifico', async () => {
    apri(inContanti({ total_price: 0, wallet_applied_cents: 4000 }));
    const id = await resoDallaPaginaVecchia();

    expect((await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 })).status).toBe(200);

    expect(creditoDi(finto.db, 'giulia')).toBe(4000);
    expect(avvisi()).toHaveLength(0);
    expect(String(ordine().stripe_refund_id ?? '')).not.toContain('bonifico:');
    expect(finto.db.tabelle.returns[0].refund_id).toBe(`wallet:return_${id}`);
  });
});
