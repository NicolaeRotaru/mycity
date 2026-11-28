import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * UN RIMBORSO DEI CONTANTI INTERROTTO A METÀ, RIPRESO CON LA STESSA CHIAVE, FINISCE.
 *
 * `refundOrder` scrive il segno del bonifico con lo stato del pagamento (REFUNDED o
 * PARTIALLY_REFUNDED), poi l'avviso, poi la quota del negozio e lo stato del bonifico al negozio.
 * Qui il processo si ferma proprio alla quota (prima o dopo averla scritta) e il rimborso si
 * riprende con la stessa chiave: deve finire con la quota giusta, una volta sola, e con lo stato del
 * bonifico al negozio scritto, così il ritiro entra nel bonifico del lunedì o fra le quote da
 * recuperare (999i, 999j).
 *
 * Gira la `refundOrder` VERA; finti il database (con `togli_quota_del_rimborso` come la 999j),
 * Stripe e la posta.
 */

const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  /** Dove si ferma il processo alla prossima quota: prima di scriverla, dopo averla scritta, o mai. */
  muore: null as null | 'prima' | 'dopo',
  /** La funzione della 999j non c'è ancora. */
  senzaFunzione: false,
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({ refunds: { create: vi.fn() }, transfers: { createReversal: vi.fn() } }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));

import { refundOrder } from '@/lib/stripe/payout';

const ORDINE = 'a1b2c3d4-2222-4222-8222-222222222222';
const CHIAVE = 'dispute_d1';

/** Ritiro da 20 € pagato in contanti al banco: commissione 2,00 €, netto del negozio 18,00 €. */
function ritiroAlBanco(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 20, gross_total_cents: 2000, wallet_applied_cents: 0,
    seller_payout_cents: 1800, seller_payout_reversed_cents: 0, payout_status: 'CASH_IN_STORE',
    application_fee_cents: 200, pickup_in_store: true,
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

function apri(ordine: Riga) {
  finto.muore = null;
  finto.senzaFunzione = false;
  finto.db = creaFintoDatabase({
    orders: [ordine],
    returns: [],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
  // `togli_quota_del_rimborso` come nella 999j: una chiave, una quota sola, mai oltre il netto.
  const quote = new Map<string, number>();
  const rpcDiPrima = finto.db.client.rpc;
  (finto.db.client as { rpc: typeof rpcDiPrima }).rpc = async (nome: string, args: Record<string, unknown> = {}) => {
    if (nome !== 'togli_quota_del_rimborso') return rpcDiPrima(nome, args);
    finto.db.rpc.push({ nome, args });
    if (finto.senzaFunzione) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    if (finto.muore === 'prima') {
      finto.muore = null;
      throw new Error('processo fermato prima della quota');
    }
    const o = finto.db.tabelle.orders.find((r) => r.id === args.p_order_id)!;
    const k = `${String(args.p_order_id)}|${String(args.p_chiave)}`;
    let tolta = 0;
    if (!quote.has(k)) {
      const prima = Number(o.seller_payout_reversed_cents ?? 0);
      const dopo = Math.max(prima, Math.min(prima + Number(args.p_centesimi), Number(o.seller_payout_cents ?? 0)));
      o.seller_payout_reversed_cents = dopo;
      tolta = dopo - prima;
      quote.set(k, tolta);
    }
    if (finto.muore === 'dopo') {
      finto.muore = null;
      throw new Error('processo fermato dopo la quota');
    }
    return { data: tolta, error: null };
  };
}

const ordine = () => finto.db.tabelle.orders[0];
const rimborsa = (centesimi: number) => refundOrder({ orderId: ORDINE, amountCents: centesimi, idempotencyKey: CHIAVE });

beforeEach(() => apri(ritiroAlBanco()));

describe('il rimborso pieno di un ritiro al banco, interrotto alla quota e ripreso', () => {
  it('IL CASO — fermo prima della quota: la ripresa toglie 18,00 € al negozio e scrive REFUNDED', async () => {
    finto.muore = 'prima';
    await expect(rimborsa(2000)).rejects.toThrow('processo fermato');
    // Lo stato che restava per sempre: pagamento rimborsato, bonifico al negozio ancora «al banco».
    expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', payout_status: 'CASH_IN_STORE', seller_payout_reversed_cents: 0 });
    expect(String(ordine().stripe_refund_id)).toContain(`bonifico:2000:${CHIAVE}`);

    await rimborsa(2000);
    expect(ordine().seller_payout_reversed_cents, 'la ripresa non ha tolto la quota del negozio').toBe(1800);
    expect(ordine().payout_status, 'la ripresa non ha scritto lo stato del bonifico al negozio').toBe('REFUNDED');
    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare'), 'il bonifico al cliente chiesto due volte').toHaveLength(1);
  });

  it('fermo dopo la quota: la ripresa non la toglie una seconda volta', async () => {
    finto.muore = 'dopo';
    await expect(rimborsa(2000)).rejects.toThrow('processo fermato');
    expect(ordine()).toMatchObject({ payout_status: 'CASH_IN_STORE', seller_payout_reversed_cents: 1800 });

    await rimborsa(2000);
    await rimborsa(2000);
    expect(ordine().seller_payout_reversed_cents, 'quota tolta due volte').toBe(1800);
    expect(ordine().payout_status).toBe('REFUNDED');
  });
});

describe('il rimborso parziale, interrotto alla quota e ripreso', () => {
  it('5,00 € su 20 €: la ripresa toglie 4,50 € e il ritiro resta al banco, rimborsato in parte', async () => {
    finto.muore = 'prima';
    await expect(rimborsa(500)).rejects.toThrow('processo fermato');
    expect(ordine()).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED', seller_payout_reversed_cents: 0 });

    await rimborsa(500);
    await rimborsa(500);
    expect(ordine()).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED', payout_status: 'CASH_IN_STORE', seller_payout_reversed_cents: 450 });
  });
});

describe('senza la funzione della 999j la ripresa non indovina', () => {
  it('la quota non si tocca e chi amministra riceve l avviso da controllare', async () => {
    finto.muore = 'prima';
    await expect(rimborsa(2000)).rejects.toThrow('processo fermato');
    finto.senzaFunzione = true;
    await rimborsa(2000);
    expect(ordine().seller_payout_reversed_cents).toBe(0);
    expect(notificheConTitolo(finto.db, 'quota del negozio da controllare')).toHaveLength(1);
  });
});
