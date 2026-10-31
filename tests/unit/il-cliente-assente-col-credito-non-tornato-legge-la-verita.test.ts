import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 31/10/2026 (collaudo) — IL CLIENTE ASSENTE CON IL CREDITO CHE NON TORNA LEGGE LA VERITÀ.
 *
 * Copia della prova del fattorino che segna «cliente assente», con una differenza:
 * la scrittura del credito MyCity (`wallet_credit`) cade a ogni tentativo. Prima il
 * cliente leggeva comunque «Ti abbiamo rimborsato tutto» (e, coi contanti, l email
 * «il credito ... ti è stato restituito»), mentre 4 € del suo credito restavano fermi.
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
const notifyAdminsMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: (...a: unknown[]) => notifyAdminsMock(...a) }));
const sendEmailMock = vi.fn(async (_m: { html: string; text: string }) => ({ ok: true }));
vi.mock('@/lib/email/client', () => ({ sendEmail: (m: { html: string; text: string }) => sendEmailMock(m) }));
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

const creditoGiu = { si: true };

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
    if (name === 'wallet_credit' && creditoGiu.si) return Promise.resolve({ data: null, error: { message: 'timeout' } });
    return Promise.resolve({ data: null, error: null });
  },
  auth: { admin: { getUserById: async () => ({ data: { user: { email: 'cliente@example.it' } }, error: null }) } },
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
  db.scritture = [];
  db.rpc = [];
  db.notifiche = [];
  utente.id = RIDER;
  creditoGiu.si = true;
  refundOrderMock.mockClear();
  notifyAdminsMock.mockClear();
  sendEmailMock.mockClear();
});

/** La notifica in-app che la rotta scrive al cliente. */
function allaPersona(): { title: string; body: string } {
  const righe = (db.notifiche as Array<Array<{ user_id: string; title: string; body: string }>>).flat();
  const r = righe.find((n) => n.user_id === 'cliente-1' && n.title.includes('non eri in casa'));
  if (!r) throw new Error('notifica al cliente non scritta');
  return r;
}

describe('cliente assente, credito MyCity che non torna', () => {
  it('carta con 4 € di credito, wallet_credit giù 3 volte: il cliente NON legge «rimborsato tutto»', async () => {
    db.ordine = carta({ wallet_applied_cents: 400 });
    const { status } = await tocca();

    expect(status).toBe(200);
    expect(db.rpc.filter((c) => c.name === 'wallet_credit').length).toBe(3);
    const n = allaPersona();
    expect(n.body).not.toMatch(/rimborsato tutto/i);
    expect(n.body).toMatch(/credito MyCity/);
    expect(n.body).toMatch(/4,00 €/);
    expect(n.body).toMatch(/non è ancora tornato/);
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
  });

  it('contanti con 4 € di credito, wallet_credit giù: né la notifica né l email dicono che il credito è tornato', async () => {
    db.ordine = ordine({ wallet_applied_cents: 400 });
    const { status } = await tocca();

    expect(status).toBe(200);
    const n = allaPersona();
    expect(n.body).toMatch(/Non devi pagare niente/);
    expect(n.body).toMatch(/\(4,00 €\) non è ancora tornato/);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const posta = sendEmailMock.mock.calls[0][0];
    expect(posta.text + posta.html).not.toMatch(/ti è stato restituito/);
  });

  it('controprova: col credito tornato davvero la carta dice «rimborsato tutto» e l email lo conferma coi contanti', async () => {
    creditoGiu.si = false;
    db.ordine = carta({ wallet_applied_cents: 400 });
    await tocca();
    expect(allaPersona().body).toMatch(/Ti abbiamo rimborsato tutto/);
    expect(notifyAdminsMock).not.toHaveBeenCalled();

    db.notifiche = [];
    db.ordine = ordine({ wallet_applied_cents: 400 });
    await tocca();
    expect(allaPersona().body).not.toMatch(/non è ancora tornato/);
    const posta = sendEmailMock.mock.calls.at(-1)![0];
    expect(posta.text + posta.html).toMatch(/ti è stato restituito/);
  });
});
