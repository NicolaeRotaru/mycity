import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R82 — UN RIMBORSO DEI CONTANTI E' REGISTRATO SOLO SE L'AVVISO A CHI PAGA E' SCRITTO.
 *
 * Senza la lista dei bonifici (decisione di Nicola del 17/10/2026), l'avviso agli amministratori
 * «💶 Bonifico di rimborso da fare» e' l'unico promemoria del debito. Se il rimborso si registrava e
 * l'avviso no, il cliente aspettava soldi che nessuno sapeva di dovergli. Adesso i passi del ramo
 * dei contanti stanno tutti nello stesso blocco, in quest'ordine:
 *   prenotazione → segno del bonifico con lo stato del pagamento → avviso → credito MyCity (ultimo)
 * e se uno cade, quelli fatti prima tornano indietro: «rimborso registrato» vuol dire segno, stato,
 * avviso (e credito), oppure niente.
 *
 * La variante scomoda e' l'ordine misto (20 € di credito, 30 in contanti): se il credito usciva prima
 * dell'avviso e l'avviso cadeva, il negozio poteva respingere il reso e la cliente teneva 20 € di
 * credito su un rimborso che non c'era.
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

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
const NON_PARTITO = "Il rimborso non è partito: riprova o scrivi all'assistenza.";
const CADUTA = { code: '57014', message: 'canceling statement due to statement timeout' };
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

function apri(ordine: Riga, amministratori: Riga[] = [{ id: 'admin-1', role: 'admin' }]) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    returns: [],
    order_items: [],
    disputes: [{ id: 'd1', status: 'open', order_id: ORDINE, opener_id: 'giulia', against_id: 'negozio' }],
    profiles: [...amministratori, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
}

const ordine = () => finto.db.tabelle.orders[0];
const reso = () => finto.db.tabelle.returns[0];
const avvisi = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
const storni = () => finto.db.rpc.filter((c) => c.nome === 'storna_rimborso');

/** Il rimborso non ha lasciato niente di registrato: ne' soldi prenotati, ne' segno, ne' avviso. */
function nienteRegistrato() {
  expect(ordine().refunded_amount_cents, 'la prenotazione e rimasta: il rimborso risulta fatto').toBe(0);
  expect(String(ordine().stripe_refund_id ?? ''), 'il segno del bonifico e rimasto sull ordine').not.toContain('bonifico:');
  expect(ordine().payment_status, 'l ordine risulta rimborsato senza un bonifico chiesto').toBe('PAID');
  expect(avvisi(), 'resta chiesto un bonifico per un rimborso che non c e').toHaveLength(0);
}

async function apriIlReso(): Promise<string> {
  finto.utente = 'giulia';
  const res = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'DAMAGED' })), undefined,
  );
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

async function negozio(rotta: unknown, id: string, corpo: unknown) {
  finto.utente = 'negozio';
  const res = await (rotta as Rotta)(new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) });
  return { status: res.status, corpo: await res.json() };
}

beforeEach(() => apri(inContanti()));

describe('l avviso non si scrive: il rimborso non e registrato', () => {
  it('IL CASO — refundOrder lancia, la prenotazione torna indietro, niente segno e niente stato', async () => {
    finto.db.guasti.notificheCadono = CADUTA;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    expect(storni()).toHaveLength(1);
    nienteRegistrato();
  });

  it('decide: il reso torna da decidere, il negozio legge «non è partito», e al secondo tentativo tutto una volta', async () => {
    const id = await apriIlReso();
    finto.db.guasti.notificheCadono = CADUTA;

    const primo = await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 });

    expect(primo.status).toBe(502);
    expect(primo.corpo.error.message).toBe(NON_PARTITO);
    expect(reso().status).toBe('REQUESTED');
    nienteRegistrato();

    finto.db.guasti.notificheCadono = null;
    const secondo = await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 });

    expect(secondo.status, JSON.stringify(secondo.corpo)).toBe(200);
    expect(avvisi()).toHaveLength(1);
    expect(ordine()).toMatchObject({
      payment_status: 'REFUNDED', refunded_amount_cents: 4000, stripe_refund_id: `bonifico:4000:return_${id}`,
    });
  });

  it('l avviso si scrive ma la risposta si perde: si toglie, e il secondo tentativo lo scrive una volta', async () => {
    finto.db.guasti.notificheScrivonoPoiCadono = true;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow();
    nienteRegistrato();

    await refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' });
    expect(avvisi()).toHaveLength(1);
    expect(ordine().payment_status).toBe('REFUNDED');
  });

  it('il segno del bonifico non si scrive sull ordine: niente avviso, niente stato, prenotazione tornata', async () => {
    finto.db.guasti.segnoDelBonificoCade = CADUTA;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    expect(storni()).toHaveLength(1);
    nienteRegistrato();
  });

  it('nessun amministratore a cui mandarlo: il rimborso non parte (non resta un debito che nessuno legge)', async () => {
    apri(inContanti(), []);

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow(/nessun amministratore/u);

    expect(storni()).toHaveLength(1);
    nienteRegistrato();
  });
});

describe('ordine misto: il credito MyCity esce per ultimo', () => {
  beforeEach(() => apri(misto()));

  it('l avviso cade: il credito non esce, e il negozio che poi respinge il reso non lascia credito a nessuno', async () => {
    const id = await apriIlReso();
    finto.db.guasti.notificheCadono = CADUTA;

    const primo = await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 5000 });
    expect(primo.status).toBe(502);
    expect(finto.db.rpc.some((c) => c.nome === 'wallet_credit'), 'il credito e uscito prima dell avviso').toBe(false);

    finto.db.guasti.notificheCadono = null;
    const respinto = await negozio(decidi, id, { decision: 'REJECTED', notes: 'merce integra' });
    expect(respinto.status).toBe(200);
    expect(creditoDi(finto.db, 'giulia'), 'reso respinto e la cliente tiene il credito').toBe(0);
    nienteRegistrato();
  });

  it('il credito cade dopo l avviso: l avviso si toglie, il segno pure, la prenotazione torna', async () => {
    finto.db.guasti.walletCredit = CADUTA;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    expect(creditoDi(finto.db, 'giulia')).toBe(0);
    nienteRegistrato();

    // Il ritentativo con il database sano: tutto una volta.
    finto.db.guasti.walletCredit = null;
    await refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' });
    expect(creditoDi(finto.db, 'giulia')).toBe(2000);
    expect(avvisi()).toHaveLength(1);
    expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', stripe_refund_id: 'bonifico:3000:return_r1' });
  });

  it('il credito uscito al primo tentativo (risposta persa, diario muto) non si ripete al secondo, e la cifra torna', async () => {
    finto.db.guasti.walletCreditaPoiCade = true;
    finto.db.guasti.diarioIlleggibile = 1;
    await expect(refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' })).rejects.toThrow();
    expect(creditoDi(finto.db, 'giulia')).toBe(2000);
    expect(avvisi()).toHaveLength(0);

    const esito = await refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' });

    expect(esito).toMatchObject({ creditoCents: 2000, bonificoCents: 3000 });
    expect(creditoDi(finto.db, 'giulia'), 'credito dato due volte').toBe(2000);
    expect(avvisi()).toHaveLength(1);
  });
});

describe('avanza e resolve: chi ha premuto legge una frase, mai l errore grezzo', () => {
  it('avanza: l avviso cade → 502 «non è partito», il reso torna «ricevuto», niente registrato', async () => {
    const id = await apriIlReso();
    expect((await negozio(decidi, id, { decision: 'APPROVED' })).status).toBe(200);
    expect((await negozio(avanza, id, { stato: 'RECEIVED' })).status).toBe(200);
    finto.db.guasti.notificheCadono = CADUTA;

    const rimborsato = await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 4000 });

    expect(rimborsato.status).toBe(502);
    expect(rimborsato.corpo.error.message).toBe(NON_PARTITO);
    expect(JSON.stringify(rimborsato.corpo)).not.toContain('[stripe]');
    expect(reso().status).toBe('RECEIVED');
    nienteRegistrato();
  });

  it('avanza: un credito gia uscito con un altra cifra → 409 con la cifra, come decide', async () => {
    apri(misto());
    const id = await apriIlReso();
    expect((await negozio(decidi, id, { decision: 'APPROVED' })).status).toBe(200);
    expect((await negozio(avanza, id, { stato: 'RECEIVED' })).status).toBe(200);
    finto.db.guasti.walletCreditaPoiCade = true;
    finto.db.guasti.diarioIlleggibile = 1;
    expect((await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 5000 })).status).toBe(502);

    finto.db.guasti.walletCredit = { message: 'FetchError: socket hang up' };
    const diverso = await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 3000 });

    expect(diverso.status).toBe(409);
    expect(diverso.corpo.error.message).toContain('20,00');
  });

  it('resolve: l avviso cade → 502 «non è partito», il reclamo resta aperto, niente registrato', async () => {
    finto.db.guasti.notificheCadono = CADUTA;

    const res = await (risolvi as unknown as Rotta)(
      new Request('http://localhost/api/admin/disputes/d1/resolve', json({
        status: 'resolved_buyer', notes: 'Merce arrivata rotta: rimborso al cliente.', refundCents: 4000,
      })),
      { params: Promise.resolve({ id: 'd1' }) },
    );
    const corpo = await res.json();

    expect(res.status).toBe(502);
    expect(corpo.error.message).toBe(NON_PARTITO);
    expect(JSON.stringify(corpo)).not.toContain('[stripe]');
    expect(finto.db.tabelle.disputes[0].status).toBe('open');
    nienteRegistrato();
  });
});
