import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R04-002 — DOPO UN GUASTO, CHIUDERE IL RESO COI PASSI NORMALI NON REGISTRA DUE VOLTE LO STESSO
 * RIMBORSO, E AL NEGOZIO LA SUA PARTE NON SI TOGLIE DUE VOLTE.
 *
 * Ordine in contanti da 40 € pagato col credito MyCity. Il negozio approva un rimborso di 20 €:
 * il credito esce, la quota del negozio (18 €) si toglie, ma il segno `wallet:<chiave>` che dice
 * «finito» si scriveva DOPO, a parte: se quella scrittura cadeva (finiva solo nel log) o la funzione
 * si fermava lì, e poi cadeva anche l'esito sul reso, i passi normali («merce ricevuta»,
 * «rimborsato») ripassavano dal rimborso con la stessa chiave: 40 € rimborsati sull'ordine (la
 * cliente ne ha 20) e 36 € tolti al negozio invece di 18.
 *
 * La prova fa girare le rotte VERE dei resi e `refundOrder` contro il finto database dei rimborsi.
 */

const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  utente: 'giulia',
  resoCade: false,
  segnoCade: null as null | 'errore' | 'eccezione',
}));

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

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';
import { refundOrder } from '@/lib/stripe/payout';

const ORDINE = 'a1b2c3d4-6666-4666-8666-666666666666';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** 40 € tutti col credito MyCity, ordine in contanti consegnato; al negozio 36 €. */
function coiCrediti(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 0, gross_total_cents: 4000, wallet_applied_cents: 4000,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
    cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null,
    ...extra,
  };
}

/**
 * I guasti a comando: la scrittura dell'esito sul reso (quella con `refund_id`) va in timeout, e
 * la scrittura del segno del rimborso in credito sull'ordine cade (errore) o ferma tutto (eccezione,
 * come una funzione chiusa a metà). Ognuno vale una volta.
 */
function guastiAComando(db: FintoDatabase) {
  const from = db.client.from.bind(db.client) as unknown as (t: string) => Record<string, unknown>;
  const catenaCaduta = (comeCade: 'errore' | 'eccezione') => {
    const catena: Record<string, unknown> = {};
    catena.eq = () => catena;
    catena.is = () => catena;
    catena.select = async () => {
      if (comeCade === 'eccezione') throw new Error('funzione fermata a metà');
      return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    };
    return catena;
  };
  (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = from(t);
    if (t !== 'returns' && t !== 'orders') return q;
    return new Proxy(q, {
      get(obj, prop, recv) {
        if (prop !== 'update') return Reflect.get(obj, prop, recv);
        const update = (Reflect.get(obj, prop, recv) as (p: Record<string, unknown>) => unknown).bind(obj);
        return (p: Record<string, unknown>) => {
          if (t === 'returns' && finto.resoCade && 'refund_id' in p) {
            finto.resoCade = false;
            return catenaCaduta('errore');
          }
          if (t === 'orders' && finto.segnoCade && String(p.stripe_refund_id ?? '').includes('wallet:')) {
            const comeCade = finto.segnoCade;
            finto.segnoCade = null;
            return catenaCaduta(comeCade);
          }
          return update(p);
        };
      },
    });
  };
}

async function apri(): Promise<string> {
  finto.utente = 'giulia';
  const aperto = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'DAMAGED', description: 'Arrivato rotto, la scatola era schiacciata' })),
    undefined,
  );
  expect(aperto.status).toBe(201);
  return (await aperto.json()).id as string;
}

/** Il negozio fa i passi normali finché il reso non è rimborsato: approva 20 €, «merce ricevuta», «rimborsato». */
async function ilNegozioFaIPassiNormali(id: string): Promise<void> {
  finto.utente = 'negozio';
  for (let giro = 0; giro < 10; giro++) {
    const stato = finto.db.tabelle.returns.find((r) => r.id === id)?.status;
    if (stato === 'REFUNDED') return;
    const params = { params: Promise.resolve({ id }) };
    if (stato === 'REQUESTED') {
      await (decidi as unknown as Rotta)(new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: 2000 })), params);
    } else if (stato === 'APPROVED') {
      await (avanza as unknown as Rotta)(new Request('http://localhost/x', json({ stato: 'RECEIVED' })), params);
    } else if (stato === 'RECEIVED') {
      await (avanza as unknown as Rotta)(new Request('http://localhost/x', json({ stato: 'REFUNDED' })), params);
    } else {
      throw new Error(`reso in uno stato inatteso: ${String(stato)}`);
    }
  }
  throw new Error('il reso non arriva mai a «rimborsato»');
}

const ordine = () => finto.db.tabelle.orders[0];
const creditoUscito = (ref: string) => finto.db.diarioCredito.filter((r) => r.ref === ref).reduce((s, r) => s + r.cents, 0);

beforeEach(() => {
  finto.utente = 'giulia';
  finto.resoCade = false;
  finto.segnoCade = null;
  finto.db = creaFintoDatabase({
    orders: [coiCrediti()],
    returns: [],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', role: 'buyer' }],
    notifications: [],
    cod_reconciliations: [],
  });
  finto.db.email.giulia = 'giulia.bianchi@example.it';
  guastiAComando(finto.db);
});

describe('R04-002 · il rimborso in credito ripreso dopo un guasto', () => {
  it('IL CASO DELLA SCHEDA — cade la scrittura del segno e poi quella del reso: coi passi normali 20 € sull ordine e 18 € al negozio', async () => {
    const id = await apri();
    finto.segnoCade = 'errore';
    finto.resoCade = true;

    await ilNegozioFaIPassiNormali(id);

    expect(Number(ordine().refunded_amount_cents), 'il rimborso si registra due volte: 40 € sull ordine, 20 € alla cliente').toBe(2000);
    expect(Number(ordine().seller_payout_reversed_cents), 'al negozio la sua parte si toglie due volte').toBe(1800);
    expect(ordine().payment_status, 'l ordine risulta rimborsato per intero').toBe('PARTIALLY_REFUNDED');
    expect(creditoUscito(`return_${id}`), 'il credito esce una volta sola').toBe(2000);
    expect(finto.db.tabelle.returns[0].status).toBe('REFUNDED');
  }, 60000);

  it('la funzione si ferma sulla scrittura del segno: coi passi normali il rimborso resta uno solo', async () => {
    const id = await apri();
    finto.segnoCade = 'eccezione';

    await ilNegozioFaIPassiNormali(id);

    expect(Number(ordine().refunded_amount_cents), 'rimborso registrato due volte').toBe(2000);
    expect(Number(ordine().seller_payout_reversed_cents), 'quota del negozio tolta due volte').toBe(1800);
    expect(creditoUscito(`return_${id}`)).toBe(2000);
  }, 60000);

  it('il tentativo di prima si è fermato dopo segno e quota, prima del credito: la ripresa dà solo il credito', async () => {
    // Come lo lascia un tentativo morto subito prima dell'accredito: prenotazione contata, segno e quota scritti.
    finto.db.tabelle.orders[0] = coiCrediti({ refunded_amount_cents: 2000, seller_payout_reversed_cents: 1800, stripe_refund_id: 'wallet:return_rX' });

    await refundOrder({ orderId: ORDINE, amountCents: 2000, reason: 'reso', metadata: { return_id: 'rX' }, idempotencyKey: 'return_rX' });

    expect(creditoUscito('return_rX'), 'la cliente non riceve il credito che le spetta').toBe(2000);
    expect(Number(ordine().refunded_amount_cents), 'la ripresa prenota una seconda volta').toBe(2000);
    expect(Number(ordine().seller_payout_reversed_cents), 'la ripresa toglie la quota una seconda volta').toBe(1800);
  });

  it('il credito che non esce rimette tutto com era: niente segno, niente quota, niente prenotazione', async () => {
    finto.db.guasti.walletCredit = { message: 'connection reset' };

    await expect(
      refundOrder({ orderId: ORDINE, amountCents: 2000, reason: 'reso', metadata: { return_id: 'rY' }, idempotencyKey: 'return_rY' }),
    ).rejects.toThrow();

    expect(Number(ordine().refunded_amount_cents)).toBe(0);
    expect(Number(ordine().seller_payout_reversed_cents)).toBe(0);
    expect(ordine().stripe_refund_id ?? null).toBeNull();
    expect(creditoUscito('return_rY')).toBe(0);
  });
});
