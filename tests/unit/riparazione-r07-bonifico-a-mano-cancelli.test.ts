import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * IL BONIFICO MANUALE (/api/stripe/payout): IL SEGRETO, I CANCELLI E UN BONIFICO SOLO.
 *
 * La rotta vera con il vero `releaseOrderPayout`, su un database finto e uno Stripe finto: si vede
 * che senza il segreto interno non parte niente, che ogni cancello del giro (contestazione in banca,
 * reclamo, reso, ora di attesa) ferma il bonifico, e che chiamarla due volte, anche insieme, non
 * paga il negozio due volte.
 */

type Bonifico = { id: string; amount: number; destination: string; metadata: Record<string, string>; chiave: string };
const stato: { db: FintoDatabase; suStripe: Bonifico[] } = { db: fintoDatabase({}), suStripe: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    transfers: {
      create: async (p: { amount: number; destination: string; metadata: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = stato.suStripe.find((b) => b.chiave === o.idempotencyKey);
        if (gia) return { id: gia.id };
        const nuovo = { id: `tr_${stato.suStripe.length + 1}`, amount: p.amount, destination: p.destination, metadata: { ...p.metadata }, chiave: o.idempotencyKey };
        stato.suStripe.push(nuovo);
        return { id: nuovo.id };
      },
      list: async () => ({ data: stato.suStripe.map((b) => ({ id: b.id, amount: b.amount, metadata: { ...b.metadata } })) }),
    },
  }),
}));

import { POST as payout } from '@/app/api/stripe/payout/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const SEGRETO = 'segreto-di-prova';

const chiama = (intestazioni: Record<string, string> = { 'x-internal-secret': SEGRETO }, corpo: unknown = { orderId: ORDINE }) =>
  (payout as unknown as (r: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/stripe/payout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...intestazioni },
    body: JSON.stringify(corpo),
  }));

/** Consegnato alle 8, sono le 10: l'ora di attesa è passata. 22,50 € al negozio, pagato con carta. */
function ordineConsegnato(extra: Riga = {}): Riga {
  return {
    id: ORDINE, seller_id: 'negozio1', rider_id: null,
    payout_status: 'HELD', seller_payout_cents: 2250, seller_payout_reversed_cents: 0, payout_tentativo: 0,
    payout_claimed_at: null, stripe_charge_id: 'ch_1', stripe_transfer_group: `order_${ORDINE}`, stripe_transfer_id: null,
    delivery_status: 'DELIVERED', payment_method: 'card', delivered_at: '2026-11-16T08:00:00.000Z',
    dispute_status: null, internal_dispute_status: null,
    rider_payout_status: null, rider_payout_claimed_at: null, rider_fee_cents: 0, rider_payout_tentativo: 0,
    total_price: 30, pickup_in_store: false, cash_confirmed_at: null,
    ...extra,
  };
}
const ordine = () => stato.db.tabelle.orders!.find((r) => r.id === ORDINE)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
  process.env.INTERNAL_API_SECRET = SEGRETO;
  stato.suStripe = [];
  stato.db = fintoDatabase({
    orders: [ordineConsegnato()],
    profiles: [{ id: 'negozio1', stripe_account_id: 'acct_negozio', stripe_payouts_enabled: true }],
    returns: [],
    disputes: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/api/stripe/payout · il segreto interno', () => {
  it('senza il segreto, o con uno sbagliato: 403 e nessun bonifico', async () => {
    expect((await chiama({})).status).toBe(403);
    expect((await chiama({ 'x-internal-secret': 'sbagliato' })).status).toBe(403);
    expect(stato.suStripe).toEqual([]);
    expect(ordine().payout_status).toBe('HELD');
  });

  it('segreto non configurato sul server: 503, mai porta aperta', async () => {
    delete process.env.INTERNAL_API_SECRET;
    expect((await chiama()).status).toBe(503);
    expect(stato.suStripe).toEqual([]);
  });
});

describe('/api/stripe/payout · i cancelli del giro', () => {
  it.each([
    ['una contestazione in banca aperta', () => { ordine().dispute_status = 'NEEDS_RESPONSE'; }],
    ['un reclamo segnato sull ordine', () => { ordine().internal_dispute_status = 'OPEN'; }],
    ['un reclamo aperto nella tabella dei reclami', () => { stato.db.tabelle.disputes!.push({ id: 'd1', order_id: ORDINE, status: 'under_review' }); }],
    ['un reso aperto', () => { stato.db.tabelle.returns!.push({ id: 'r1', order_id: ORDINE, status: 'REQUESTED' }); }],
    ['la consegna di mezz ora fa', () => { ordine().delivered_at = '2026-11-16T09:30:00.000Z'; }],
    ['resi e reclami che non si leggono', () => { stato.db.guastoLettura = (t) => (t === 'returns' ? { message: 'timeout' } : null); }],
  ])('%s: 409 e nessun bonifico', async (_nome, prepara) => {
    prepara();
    const res = await chiama();
    expect(res.status).toBe(409);
    expect(stato.suStripe).toEqual([]);
    expect(ordine().payout_status).toBe('HELD');
  });

  it('una contestazione VINTA non ferma il bonifico', async () => {
    ordine().dispute_status = 'WON';
    expect((await chiama()).status).toBe(200);
    expect(stato.suStripe).toHaveLength(1);
  });

  it('id dell ordine che non è un UUID: 400', async () => {
    expect((await chiama(undefined, { orderId: 'non-un-uuid' })).status).toBe(400);
    expect(stato.suStripe).toEqual([]);
  });
});

describe('/api/stripe/payout · un bonifico solo', () => {
  it('il percorso buono: 22,50 € al conto del negozio, ordine TRANSFERRED', async () => {
    const res = await chiama();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { transferId: 'tr_1' } });
    expect(stato.suStripe).toEqual([expect.objectContaining({ amount: 2250, destination: 'acct_negozio' })]);
    expect(ordine()).toMatchObject({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1' });
  });

  it('chiamata una seconda volta: 409, e su Stripe resta un bonifico solo', async () => {
    expect((await chiama()).status).toBe(200);
    expect((await chiama()).status).toBe(409);
    expect(stato.suStripe).toHaveLength(1);
  });

  it('due chiamate insieme: un bonifico solo', async () => {
    const esiti = await Promise.all([chiama(), chiama()]);
    expect(esiti.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(stato.suStripe).toHaveLength(1);
    expect(ordine().payout_status).toBe('TRANSFERRED');
  });
});
