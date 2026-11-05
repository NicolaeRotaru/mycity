/**
 * Sessione S02 (5/11/2026) — schede 317 e 173: «Cliente assente» anche da «ritirato», e i contanti
 * non si dichiarano più appena ritirato al negozio (banco copiato da
 * il-fattorino-puo-segnare-il-cliente-assente).
 */
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


describe('317 · cliente assente da «ritirato»', () => {
  it('contanti, ritirato (PICKED_UP): l ordine si annulla col motivo cliente_assente', async () => {
    db.ordine = ordine({ delivery_status: 'PICKED_UP' });
    const { status } = await tocca();
    expect(status).toBe(200);
    expect(db.ordine.delivery_status).toBe('CANCELED');
  });

  it('assegnato (ASSIGNED, merce non ancora ritirata): resta 409', async () => {
    db.ordine = ordine({ delivery_status: 'ASSIGNED' });
    expect((await tocca()).status).toBe(409);
    expect(db.ordine.delivery_status).toBe('ASSIGNED');
  });
});

describe('173 · i contanti si dichiarano alla porta, non al negozio', () => {
  it('appena ritirato non c è un incasso da dichiarare; in consegna sì', async () => {
    const { incassoDaDichiarare, STATI_IN_CUI_SI_INCASSA } = await import('@/lib/rider/incasso-alla-consegna');
    const base = { payment_method: 'cod', cash_confirmed_at: null } as const;
    expect(incassoDaDichiarare({ ...base, delivery_status: 'PICKED_UP' })).toBe(false);
    expect(incassoDaDichiarare({ ...base, delivery_status: 'OUT_FOR_DELIVERY' })).toBe(true);
    expect(STATI_IN_CUI_SI_INCASSA).not.toContain('PICKED_UP');
  });
});
