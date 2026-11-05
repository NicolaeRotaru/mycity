import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * S01 — rotte dei resi (banco preso da un-rimborso-non-registrato-sul-reso-non-risponde-ok).
 *  · 1686 / 2569: se mentre il rimborso esce un'altra scheda sposta il reso, «decide»
 *    non risponde «rimborsato»: la scrittura che non tocca righe non e' riuscita.
 *  · 67: se il rimborso fallisce e anche il ritorno indietro cade, non si dice «riprova»
 *    e chi amministra viene avvisato.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia', guasto: false, corsa: false, ritornoCade: false, rimborsoCade: false }));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const c = finto.db.client;
    return {
      ...c,
      from: (tabella: string) => {
        const q = c.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (tabella !== 'returns') return q;
        const update = q.update.bind(q);
        q.update = (valori: unknown) => {
          const v = (valori ?? {}) as Record<string, unknown>;
          // Corsa: mentre il rimborso esce, un'altra scheda porta il reso a RECEIVED.
          if (finto.corsa && 'refund_id' in v) finto.db.tabelle.returns[0].status = 'RECEIVED';
          // Il ritorno indietro (stato rimesso dopo il rimborso fallito) cade.
          if (finto.ritornoCade && !('refund_id' in v) && (v.status === 'REQUESTED' || v.status === 'RECEIVED')) {
            const caduta: Record<string, unknown> = {};
            caduta.eq = () => caduta;
            caduta.select = () => caduta;
            caduta.then = (ok: (x: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' } }).then(ok);
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
vi.mock('@/lib/stripe/payout', async (o) => {
  const vero = (await o()) as typeof import('@/lib/stripe/payout');
  return {
    ...vero,
    refundOrder: (async (a: Parameters<typeof vero.refundOrder>[0]) => {
      if (finto.rimborsoCade) throw new Error('rete giu');
      return vero.refundOrder(a);
    }) as typeof vero.refundOrder,
  };
});
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: finto.utente }, req, params: (await ctx?.params) ?? {} }),
}));

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';

function maglione(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio', total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0,
    payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), payment_status: 'PAID',
    cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
  };
}

const json = (corpo: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

async function chiama(rotta: unknown, corpo: unknown, id: string) {
  const res = await (rotta as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) },
  );
  return { status: res.status, corpo: await res.json() };
}

/** Il reso del maglione, arrivato fino a «merce ricevuta». */
async function resoRicevuto(): Promise<string> {
  const id = await resoAperto();
  finto.utente = 'negozio';
  expect((await chiama(decidi, { decision: 'APPROVED' }, id)).status).toBe(200);
  expect((await chiama(avanza, { stato: 'RECEIVED' }, id)).status).toBe(200);
  return id;
}

/** Il reso del maglione, appena aperto dalla cliente. */
async function resoAperto(): Promise<string> {
  finto.utente = 'giulia';
  const res = await (apriReso as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND' })),
    undefined,
  );
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

beforeEach(() => {
  finto.guasto = false;
  finto.corsa = false;
  finto.ritornoCade = false;
  finto.rimborsoCade = false;
  finto.db = creaFintoDatabase({
    orders: [maglione()],
    returns: [],
    order_items: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
});


describe('1686 — decide: la scrittura finale che non trova il reso non e\' un ok', () => {
  it('un\'altra scheda sposta il reso mentre il rimborso esce: niente 200, e avviso a chi paga', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';
    finto.corsa = true;
    const esito = await chiama(decidi, { decision: 'APPROVED', refundAmountCents: 4000 }, id);
    finto.corsa = false;
    expect(finto.db.tabelle.orders[0].refunded_amount_cents, 'il rimborso non e partito: la prova non misura niente').toBe(4000);
    expect(esito.status).not.toBe(200);
    expect(String(esito.corpo.error?.message)).toContain('Non ripetere il rimborso');
    expect(notificheConTitolo(finto.db, 'non registrato sul reso')).toHaveLength(1);
  });
});

describe('67 — rimborso fallito e ritorno indietro caduto', () => {
  it('decide: non dice «riprova» e avvisa chi amministra', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';
    finto.rimborsoCade = true;
    finto.ritornoCade = true;
    const esito = await chiama(decidi, { decision: 'APPROVED', refundAmountCents: 4000 }, id);
    expect(esito.status).toBe(500);
    expect(String(esito.corpo.error?.message)).not.toMatch(/riprova o scrivi/);
    expect(notificheConTitolo(finto.db, 'Reso bloccato')).toHaveLength(1);
  });
  it('decide: se il ritorno indietro riesce resta il «riprova» di prima', async () => {
    const id = await resoAperto();
    finto.utente = 'negozio';
    finto.rimborsoCade = true;
    const esito = await chiama(decidi, { decision: 'APPROVED', refundAmountCents: 4000 }, id);
    expect(esito.status).toBe(502);
    expect(finto.db.tabelle.returns[0].status).toBe('REQUESTED');
    expect(notificheConTitolo(finto.db, 'Reso bloccato')).toHaveLength(0);
  });
  it('avanza: non dice «riprova» e avvisa chi amministra', async () => {
    const id = await resoRicevuto();
    finto.rimborsoCade = true;
    finto.ritornoCade = true;
    const esito = await chiama(avanza, { stato: 'REFUNDED', refundAmountCents: 4000 }, id);
    expect(esito.status).toBe(500);
    expect(String(esito.corpo.error?.message)).not.toMatch(/riprova o scrivi/);
    expect(notificheConTitolo(finto.db, 'Reso bloccato')).toHaveLength(1);
  });
});
