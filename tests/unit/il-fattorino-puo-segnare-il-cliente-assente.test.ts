import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 31/10/2026 — «CLIENTE ASSENTE»: IL FATTORINO ORA LO PUÒ SEGNARE.
 *
 * Da «in consegna» il fattorino aveva una strada sola, il codice del cliente.
 * Se alla porta non rispondeva nessuno, l'ordine restava «in consegna» per
 * sempre. Scelta di Nicola del 31/10: annullo e rimborso INTERO, niente stato
 * nuovo. I casi qui sotto sono quelli della scelta, uno per uno.
 */

const ID = '11111111-2222-4333-8444-555555555555';
const RIDER = 'rider-1';

const refundOrderMock = vi.fn(async (o: { orderId: string; amountCents: number }) => {
  db.ordine.delivery_status = 'CANCELED'; // come refundOrder vero
  return { refundId: `re_${o.orderId.slice(0, 4)}`, reversedCents: 0 };
});
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (o: { orderId: string; amountCents: number }) => refundOrderMock(o) }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

const utente = { id: RIDER };
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (c: { user: { id: string }; req: unknown; params: Record<string, string> }) => unknown) =>
    (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ user: utente, req, params: ctx.params }),
}));

type Riga = Record<string, unknown> & { delivery_status: string };
const db: {
  ordine: Riga;
  scritture: Record<string, unknown>[];
  rpc: Array<{ name: string; args: Record<string, unknown> }>;
  notifiche: unknown[];
} = { ordine: { delivery_status: 'OUT_FOR_DELIVERY' }, scritture: [], rpc: [], notifiche: [] };

/** Una lettura che non sa rispondere: le strade del carrello di più negozi finiscono nel «niente da rifare». */
function catenaMuta(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'neq', 'in', 'is', 'contains', 'order', 'limit']) c[k] = () => c;
  c.maybeSingle = () => Promise.resolve({ data: null, error: { message: 'finto' } });
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'finto' } }).then(ok);
  return c;
}

const admin = {
  from: (tabella: string) => {
    if (tabella === 'notifications') {
      return { insert: (r: unknown) => { db.notifiche.push(r); return Promise.resolve({ error: null }); } };
    }
    if (tabella !== 'orders') return catenaMuta();
    return {
      select: (colonne: string) => {
        const muta = catenaMuta();
        return {
          ...muta,
          eq: (campo: string, valore: unknown) =>
            campo === 'id' && colonne.includes('rider_id')
              ? { maybeSingle: () => Promise.resolve({ data: valore === ID ? { ...db.ordine } : null, error: null }) }
              : muta,
        };
      },
      update: (u: Record<string, unknown>) => {
        const c: Record<string, unknown> = {
          eq: () => c,
          neq: () => c,
          // La scrittura che prende il turno: passa solo se l'ordine non è già annullato.
          select: () => {
            if (db.ordine.delivery_status === 'CANCELED') return Promise.resolve({ data: [], error: null });
            db.scritture.push(u);
            Object.assign(db.ordine, u);
            return Promise.resolve({ data: [{ id: ID }], error: null });
          },
        };
        return c;
      },
    };
  },
  rpc: (name: string, args: Record<string, unknown>) => {
    db.rpc.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  },
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => admin }));

import { POST } from '@/app/api/rider/orders/[id]/cliente-assente/route';

function ordine(p: Partial<Riga> = {}): Riga {
  return {
    id: ID,
    user_id: 'cliente-1',
    seller_id: 'negozio-1',
    rider_id: RIDER,
    total_price: 18.5,
    payment_method: 'cod',
    payment_status: 'PENDING',
    delivery_status: 'OUT_FOR_DELIVERY',
    stripe_payment_intent: null,
    wallet_applied_cents: 0,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    coupon_code: null,
    stripe_session_id: null,
    internal_dispute_status: null,
    ...p,
  };
}
const carta = (p: Partial<Riga> = {}) =>
  ordine({ payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1', ...p });

async function tocca(id = ID) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (await (POST as any)(new Request(`http://localhost/api/rider/orders/${id}/cliente-assente`, { method: 'POST' }), {
    params: { id },
  })) as Response;
  return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  db.ordine = ordine();
  db.scritture = [];
  db.rpc = [];
  db.notifiche = [];
  utente.id = RIDER;
  refundOrderMock.mockClear();
});

describe('il fattorino segna «cliente assente»', () => {
  it('contanti, in consegna: l ordine si annulla con motivo cliente_assente e nessun rimborso Stripe', async () => {
    const { status, corpo } = await tocca();

    expect(status).toBe(200);
    expect(corpo).toMatchObject({ ok: true, motivo: 'cliente_assente', refundId: null });
    expect(db.ordine.delivery_status).toBe('CANCELED');
    expect(refundOrderMock).not.toHaveBeenCalled();
    // La merce torna al negozio come in ogni annullo.
    expect(db.rpc.some((c) => c.name === 'restore_stock_for_order' && c.args.p_order_id === ID)).toBe(true);
    expect(db.notifiche.length).toBe(1);
  });

  it('carta: torna l intero totale, spese di consegna comprese, col motivo cliente_assente', async () => {
    db.ordine = carta();
    const { status, corpo } = await tocca();

    expect(status).toBe(200);
    expect(corpo).toMatchObject({ ok: true, motivo: 'cliente_assente' });
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    expect(refundOrderMock.mock.calls[0][0]).toMatchObject({
      orderId: ID,
      amountCents: 1850,
      metadata: { source: 'cliente_assente', canceled_by: RIDER },
    });
  });

  it('il credito MyCity speso torna anche qui', async () => {
    db.ordine = ordine({ wallet_applied_cents: 400 });
    await tocca();
    expect(db.rpc.find((c) => c.name === 'wallet_credit')?.args).toMatchObject({ p_user: 'cliente-1', p_cents: 400, p_ref: ID });
  });

  it('un fattorino che non è quello assegnato riceve 403 e l ordine resta com era', async () => {
    utente.id = 'rider-2';
    const { status } = await tocca();
    expect(status).toBe(403);
    expect(db.ordine.delivery_status).toBe('OUT_FOR_DELIVERY');
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it.each(['ASSIGNED', 'PICKED_UP', 'DELIVERED'])('con l ordine %s si rifiuta: si segna solo mentre è in consegna', async (stato) => {
    db.ordine = carta({ delivery_status: stato });
    const { status } = await tocca();
    expect(status).toBe(409);
    expect(db.ordine.delivery_status).toBe(stato);
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it('doppio tocco con la carta: la seconda volta risponde «già annullato», un solo rimborso', async () => {
    db.ordine = carta();
    expect((await tocca()).status).toBe(200);
    const secondo = await tocca();
    expect(secondo.status).toBe(409);
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
  });

  it('doppio tocco simultaneo coi contanti: passa uno solo, il credito torna una volta', async () => {
    db.ordine = ordine({ wallet_applied_cents: 400 });
    const [a, b] = await Promise.all([tocca(), tocca()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.scritture.length).toBe(1);
    expect(db.rpc.filter((c) => c.name === 'wallet_credit').length).toBe(1);
    expect(db.rpc.filter((c) => c.name === 'restore_stock_for_order').length).toBe(1);
  });

  it('un ordine che non esiste è 404', async () => {
    expect((await tocca('99999999-2222-4333-8444-555555555555')).status).toBe(404);
  });
});
