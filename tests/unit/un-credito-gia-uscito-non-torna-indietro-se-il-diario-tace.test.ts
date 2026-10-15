import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R82, terzo giro di collaudo — UN CREDITO GIA' USCITO NON TORNA INDIETRO PERCHE' IL DIARIO TACE.
 *
 * Dopo un accredito riuscito, il rimborso rilegge il diario del credito solo per controllare la
 * cifra. Se quella sola lettura andava in timeout, l'errore rimetteva indietro la prenotazione:
 * il negozio leggeva «Il rimborso non è partito», il reso tornava da decidere e lui lo poteva
 * rifiutare. La cliente teneva 40 € di credito, l'ordine risultava rimborsato per 0, e i 40 € li
 * perdeva MyCity senza un avviso. Bastava UN guasto: niente risposta persa, solo il diario muto.
 *
 * Qui il guasto e' quello solo: `diarioIlleggibile`, senza `walletCreditaPoiCade`. Girano le rotte
 * VERE (create → decide, create → decide → avanza) e la `refundOrder` VERA; finti il database,
 * Stripe, l'autenticazione e la posta.
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
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: finto.utente }, req, params: (await ctx?.params) ?? {} }),
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: 'admin-1' }, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';
import { GET as listaDeiBonifici } from '@/app/api/admin/rimborsi-da-bonificare/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const IBAN = 'IT60X0542811101000000123456';
const AVVISO = 'Rimborso col credito da controllare';

/** 40 € in contanti, incassati e consegnati ieri. */
function ordineInContanti(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null,
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

/** 50 €: 20 pagati col credito MyCity e 30 in contanti, incassati. */
const ordineMisto = () => ordineInContanti({ total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500 });

function apri(ordine: Riga) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    returns: [],
    order_items: [],
    bonifici_dei_reclami: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
}

async function chiediReso(rimborso: unknown): Promise<string> {
  finto.utente = 'giulia';
  const res = await apriReso(
    new Request('http://localhost/api/returns/create', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: ORDINE, reason: 'DAMAGED', rimborso }),
    }) as never,
    undefined as never,
  );
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

async function chiama(rotta: typeof decidi, cosa: 'decide' | 'avanza', resoId: string, corpo: Record<string, unknown>) {
  finto.utente = 'negozio';
  const res = await rotta(
    new Request(`http://localhost/api/returns/${resoId}/${cosa}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
    }) as never,
    { params: Promise.resolve({ id: resoId }) } as never,
  );
  return { status: res.status, corpo: await res.json() };
}

const ordine = () => finto.db.tabelle.orders[0];
const reso = () => finto.db.tabelle.returns[0];

beforeEach(() => apri(ordineInContanti()));

// 1 = il timeout passeggero della scheda; 99 = il diario resta muto per tutto il rimborso, cosi'
// la prova non passa grazie a un secondo tentativo di lettura nascosto da qualche parte.
for (const letture of [1, 99]) {
  describe(`il diario non risponde (${letture === 1 ? 'una volta' : 'mai'}), l'accredito invece e' riuscito`, () => {
    it('create → decide: il reso si chiude rimborsato e il negozio non lo puo piu rifiutare', async () => {
      const id = await chiediReso({ modo: 'CREDITO' });
      finto.db.guasti.diarioIlleggibile = letture;

      const deciso = await chiama(decidi, 'decide', id, { decision: 'APPROVED', refundAmountCents: 4000 });
      finto.db.guasti.diarioIlleggibile = 0;

      expect(deciso.status, `il negozio legge: ${JSON.stringify(deciso.corpo)}`).toBe(200);
      expect(creditoDi(finto.db, 'giulia')).toBe(4000);
      expect(reso(), 'credito uscito e reso ancora da decidere').toMatchObject({ status: 'REFUNDED', refund_id: 'wallet:return_' + id });
      expect(ordine(), 'la cliente ha 40 € e l ordine risulta rimborsato per 0').toMatchObject({
        refunded_amount_cents: 4000, payment_status: 'REFUNDED',
      });
      expect(Number(ordine().seller_payout_reversed_cents), 'la quota del negozio deve rientrare').toBe(3600);

      const rifiuto = await chiama(decidi, 'decide', id, { decision: 'REJECTED', notes: 'merce integra' });
      expect(rifiuto.status, 'un reso gia rimborsato col credito si e rifiutato: la cliente tiene 40 € e li perde MyCity').toBe(409);
      expect(reso().status).toBe('REFUNDED');
      expect(creditoDi(finto.db, 'giulia'), 'accreditato due volte').toBe(4000);
    });

    it('create → decide → avanza: il rimborso dopo la ricezione va in fondo, e il reso non si chiude piu «di persona»', async () => {
      const id = await chiediReso({ modo: 'CREDITO' });
      expect((await chiama(decidi, 'decide', id, { decision: 'APPROVED' })).status).toBe(200);
      expect((await chiama(avanza, 'avanza', id, { stato: 'RECEIVED' })).status).toBe(200);
      finto.db.guasti.diarioIlleggibile = letture;

      const rimborso = await chiama(avanza, 'avanza', id, { stato: 'REFUNDED', refundAmountCents: 4000 });
      finto.db.guasti.diarioIlleggibile = 0;

      expect(rimborso.status, `il negozio legge: ${JSON.stringify(rimborso.corpo)}`).toBe(200);
      expect(creditoDi(finto.db, 'giulia')).toBe(4000);
      expect(ordine()).toMatchObject({ refunded_amount_cents: 4000, payment_status: 'REFUNDED' });
      expect(reso().status).toBe('REFUNDED');

      const chiuso = await chiama(avanza, 'avanza', id, { stato: 'CANCELED', note: 'chiuso di persona' });
      expect(chiuso.status, 'un reso rimborsato col credito si e chiuso come annullato').not.toBe(200);
      expect(reso().status).toBe('REFUNDED');
    });

    it('chi amministra riceve l avviso di controllare la cifra, una volta sola', async () => {
      const id = await chiediReso({ modo: 'CREDITO' });
      finto.db.guasti.diarioIlleggibile = letture;
      await chiama(decidi, 'decide', id, { decision: 'APPROVED', refundAmountCents: 4000 });

      const avvisi = notificheConTitolo(finto.db, AVVISO);
      expect(avvisi, 'il credito e uscito senza conferma della cifra e nessuno lo sa').toHaveLength(1);
      expect(String(avvisi[0].body)).toMatch(/40,00\s€/u);
      expect(String(avvisi[0].body)).toContain(`return_${id}`);
    });

    it('ordine misto (20 € di credito, 30 in contanti, bonifico): la parte del credito esce, il bonifico resta in lista per 30 €', async () => {
      apri(ordineMisto());
      const id = await chiediReso({ modo: 'BONIFICO', iban: IBAN });
      finto.db.guasti.diarioIlleggibile = letture;

      const deciso = await chiama(decidi, 'decide', id, { decision: 'APPROVED', refundAmountCents: 5000 });
      finto.db.guasti.diarioIlleggibile = 0;

      expect(deciso.status, `il negozio legge: ${JSON.stringify(deciso.corpo)}`).toBe(200);
      expect(creditoDi(finto.db, 'giulia')).toBe(2000);
      expect(ordine()).toMatchObject({ refunded_amount_cents: 5000, payment_status: 'REFUNDED' });
      expect(reso().status).toBe('REFUNDED');
      const voci = (await (await listaDeiBonifici(new Request('http://localhost/api/admin/rimborsi-da-bonificare') as never, undefined as never)).json()).voci;
      expect(voci).toHaveLength(1);
      expect(voci[0]).toMatchObject({ importoCents: 3000 });

      expect((await chiama(decidi, 'decide', id, { decision: 'REJECTED', notes: 'merce integra' })).status).toBe(409);
    });
  });
}

/**
 * Il credito c'era gia' da un tentativo prima (guasto doppio, tornato indietro), e al secondo
 * tentativo `wallet_credit` risponde 23505 — o, dopo la 143, si' col saldo di prima. Anche qui la
 * chiave c'e': se il diario non si legge, il rimborso si registra invece di tornare indietro.
 */
describe('secondo tentativo: la chiave c e gia, e il diario non risponde', () => {
  for (const comeLa143 of [false, true]) {
    it(`il rimborso si registra una volta sola (${comeLa143 ? 'dopo' : 'prima della'} 143)`, async () => {
      finto.db.comeLa143 = comeLa143;
      const id = await chiediReso({ modo: 'CREDITO' });

      // Primo tentativo: il residuo dichiarato (risposta persa E diario muto) torna indietro.
      finto.db.guasti.walletCreditaPoiCade = true;
      finto.db.guasti.diarioIlleggibile = 1;
      const primo = await chiama(decidi, 'decide', id, { decision: 'APPROVED', refundAmountCents: 4000 });
      expect(primo.status).toBe(502);
      expect(reso().status).toBe('REQUESTED');
      expect(creditoDi(finto.db, 'giulia')).toBe(4000);

      // Secondo tentativo: un guasto solo, il diario.
      finto.db.guasti.diarioIlleggibile = 1;
      const secondo = await chiama(decidi, 'decide', id, { decision: 'APPROVED', refundAmountCents: 4000 });

      expect(secondo.status, `il negozio legge: ${JSON.stringify(secondo.corpo)}`).toBe(200);
      expect(reso().status).toBe('REFUNDED');
      expect(ordine()).toMatchObject({ refunded_amount_cents: 4000, payment_status: 'REFUNDED' });
      expect(creditoDi(finto.db, 'giulia'), 'accreditato due volte').toBe(4000);
    });
  }
});

describe('il freno sulla cifra resta', () => {
  it('l accredito risponde con un errore, il diario dice 40 € e si chiedono 30: si ferma e dice quanto e gia uscito', async () => {
    const id = await chiediReso({ modo: 'CREDITO' });
    finto.db.guasti.walletCreditaPoiCade = true;
    finto.db.guasti.diarioIlleggibile = 1;
    expect((await chiama(decidi, 'decide', id, { decision: 'APPROVED', refundAmountCents: 4000 })).status).toBe(502);

    // Adesso l'accredito cade per davvero, ma il diario si legge e dice 40 €.
    finto.db.guasti.walletCredit = { message: 'FetchError: socket hang up' };
    const diverso = await chiama(decidi, 'decide', id, { decision: 'APPROVED', refundAmountCents: 3000 });

    expect(diverso.status).toBe(409);
    expect(diverso.corpo.error.message).toContain('40,00');
    expect(ordine().refunded_amount_cents, 'registrati 30 € mentre la cliente ne ha avuti 40').toBe(0);
    expect(reso().status).toBe('REQUESTED');
    expect(notificheConTitolo(finto.db, AVVISO)).toHaveLength(0);
  });
});
