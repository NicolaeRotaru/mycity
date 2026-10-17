import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * L'AVVISO DEL BONIFICO DA FARE ARRIVA UNA VOLTA SOLA PER AMMINISTRATORE (17/10/2026).
 *
 * Sul sito non c'e' piu' una lista con un «fatto»: chi paga lavora dall'avviso. Due avvisi per lo
 * stesso rimborso sono due bonifici. L'avviso si scrive con un identificativo che dipende dal
 * rimborso (`unaVoltaPer: bonifico-da-fare:<chiave>`), e il database rifiuta il secondo (23505).
 * Con piu' amministratori le righe sono una per ciascuno, con la stessa causale: chi paga la cerca
 * nei movimenti del conto prima di pagare.
 *
 * Girano le rotte VERE e la `refundOrder` VERA; finti il database (che risponde 23505 su un id
 * doppio, come quello vero), Stripe, l'autenticazione e la posta.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia', esitoDelResoCade: false }));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const c = finto.db.client;
    return {
      ...c,
      from: (tabella: string) => {
        const q = c.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (tabella !== 'returns' || !finto.esitoDelResoCade) return q;
        const update = q.update.bind(q);
        q.update = (valori: unknown) => {
          if (valori && typeof valori === 'object' && 'refund_id' in valori) {
            const caduta: Record<string, unknown> = {};
            caduta.eq = () => caduta;
            caduta.then = (ok: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }).then(ok);
            return caduta;
          }
          return update(valori);
        };
        return q;
      },
    };
  };
  return { getAdminSupabase: () => client(), getServerSupabase: async () => client() };
});
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
    (_o: unknown, handler: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: finto.utente }, req, params: (await ctx?.params) ?? {} }),
}));

import { refundOrder } from '@/lib/stripe/payout';
import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

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
    ...extra,
  };
}

function apri(amministratori: string[] = ['admin-1']) {
  finto.esitoDelResoCade = false;
  finto.db = creaFintoDatabase({
    orders: [inContanti()],
    returns: [],
    order_items: [],
    profiles: [...amministratori.map((id) => ({ id, role: 'admin' })), { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
}

const ordine = () => finto.db.tabelle.orders[0];
const avvisi = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
const perChi = () => avvisi().map((a) => a.user_id).sort();

async function negozio(rotta: unknown, id: string, corpo: unknown) {
  finto.utente = 'negozio';
  const res = await (rotta as Rotta)(new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) });
  return { status: res.status, corpo: await res.json() };
}

beforeEach(() => apri());

describe('refundOrder ritentata con la stessa chiave', () => {
  it('il primo tentativo ha scritto l avviso e poi e caduto, e l avviso non si e potuto togliere: il secondo non ne scrive un altro', async () => {
    // Il guasto doppio: su un ordine misto cade il passo dopo l'avviso (il credito), e cade anche la
    // cancellazione che toglierebbe l'avviso. Al ritentativo l'avviso c'e' gia': il database lo rifiuta.
    finto.db.tabelle.orders[0] = inContanti({ total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500 });
    finto.db.guasti.walletCredit = { code: '57014', message: 'timeout' };
    finto.db.guasti.cancellazioniCadono = { code: '57014', message: 'timeout' };
    await expect(refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' })).rejects.toThrow();
    expect(avvisi(), 'il guasto non e avvenuto: la prova non misura niente').toHaveLength(1);

    finto.db.guasti.walletCredit = null;
    finto.db.guasti.cancellazioniCadono = null;
    await refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' });

    expect(avvisi(), 'lo stesso bonifico chiesto due volte').toHaveLength(1);
    expect(ordine().payment_status).toBe('REFUNDED');
  });

  it('con due amministratori: una riga per ciascuno, con la stessa causale, e un ritentativo non ne aggiunge', async () => {
    apri(['admin-1', 'admin-2']);

    await refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' });

    expect(perChi()).toEqual(['admin-1', 'admin-2']);
    const causali = avvisi().map((a) => /«(Rimborso MyCity ordine [^»]+)»/u.exec(String(a.body))?.[1]);
    expect(causali[0]).toBe('Rimborso MyCity ordine #A1B2C3 reso R1');
    expect(causali[1]).toBe(causali[0]);
    expect(String(avvisi()[0].body)).toContain('Questo avviso arriva a ogni amministratore');

    // Lo stesso rimborso ritentato con la stessa chiave, su un ordine che la prenotazione ha
    // dimenticato (il caso del processo morto a meta'): l'avviso non si ripete per nessuno.
    finto.db.tabelle.orders[0].refunded_amount_cents = 0;
    const esito = await refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' });
    expect(esito.refundId).toBe('bonifico:4000:return_r1');
    expect(perChi()).toEqual(['admin-1', 'admin-2']);
  });
});

describe('decide cade sul reso, poi avanza registra', () => {
  it('un avviso solo, l importo rimborsato non sale, e «chiudi senza rimborso» non passa', async () => {
    finto.utente = 'giulia';
    const aperto = await (apriReso as unknown as Rotta)(
      new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'DAMAGED' })), undefined,
    );
    const id = (await aperto.json()).id as string;

    finto.esitoDelResoCade = true;
    expect((await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 })).status).toBe(500);
    finto.esitoDelResoCade = false;
    expect(avvisi()).toHaveLength(1);
    expect(ordine().refunded_amount_cents).toBe(4000);

    const chiudi = await negozio(avanza, id, { stato: 'CANCELED' });
    expect(chiudi.status).toBe(409);

    expect((await negozio(avanza, id, { stato: 'RECEIVED' })).status).toBe(200);
    const rimborsato = await negozio(avanza, id, { stato: 'REFUNDED' });

    expect(rimborsato.status, JSON.stringify(rimborsato.corpo)).toBe(200);
    expect(avvisi(), 'il bonifico chiesto due volte').toHaveLength(1);
    expect(ordine().refunded_amount_cents, 'il rimborso e stato contato due volte').toBe(4000);
    expect(finto.db.tabelle.returns[0]).toMatchObject({ status: 'REFUNDED', refund_id: `bonifico:4000:return_${id}` });
  });
});
