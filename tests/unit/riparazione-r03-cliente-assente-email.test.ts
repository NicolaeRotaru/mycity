/**
 * R03-007 (cura preparata da R06-006 nell'onda 9) — Quando il fattorino segna «cliente assente» l'ordine si annulla, ma il negozio riceveva
 * solo la campanella: l'email dell'annullo (R31-023) partiva dalle altre rotte d'annullo, non da qui.
 *
 * Qui la rotta VERA con la vera `avvisaIlNegozioDellAnnullo`: l'annullo e il rimborso sono finti
 * (non sono l'oggetto della voce), la posta è una spia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ID = '11111111-2222-4333-8444-555555555555';
const RIDER = 'rider-1';

const posta = vi.hoisted(() => ({ inviate: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: Record<string, unknown>) => { posta.inviate.push(m); return { ok: true }; }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/ordini/annulla', async (originale) => ({
  ...(await originale<typeof import('@/lib/ordini/annulla')>()),
  annullaERimborsa: vi.fn(async () => ({ ok: true, refundId: null })),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (c: { user: { id: string }; req: unknown; params: Record<string, string>; profile?: unknown }) => unknown) =>
    (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ user: { id: RIDER }, req, params: ctx.params, profile: { role: 'rider', is_approved: true } }),
}));

const db = vi.hoisted(() => ({ ordine: {} as Record<string, unknown>, notifiche: [] as unknown[] }));
const admin = {
  from: (tabella: string) => {
    if (tabella === 'notifications') {
      return { insert: (r: unknown) => { db.notifiche.push(r); return Promise.resolve({ error: null }); } };
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...db.ordine }, error: null }) }) }),
    };
  },
  auth: {
    admin: {
      getUserById: async (id: string) =>
        id === 'negozio-1'
          ? { data: { user: { email: 'negozio@esempio.it' } }, error: null }
          : { data: { user: { email: 'cliente@esempio.it' } }, error: null },
    },
  },
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => admin }));

import { POST } from '@/app/api/rider/orders/[id]/cliente-assente/route';

async function tocca() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (await (POST as any)(new Request(`http://localhost/api/rider/orders/${ID}/cliente-assente`, { method: 'POST' }), {
    params: { id: ID },
  })) as Response;
  return res.status;
}

beforeEach(() => {
  posta.inviate = [];
  db.notifiche = [];
  db.ordine = {
    id: ID, user_id: 'cliente-1', seller_id: 'negozio-1', rider_id: RIDER, total_price: 18.5,
    payment_method: 'cod', payment_status: 'PENDING', delivery_status: 'OUT_FOR_DELIVERY',
  };
});

describe('R03-007 · cliente assente: al negozio anche l email dell annullo', () => {
  it('il negozio riceve l email «annullato» con la frase della campanella', async () => {
    expect(await tocca()).toBe(200);
    const alNegozio = posta.inviate.filter((m) => m.to === 'negozio@esempio.it');
    expect(alNegozio, 'il negozio non ha ricevuto nessuna email dell annullo').toHaveLength(1);
    expect(alNegozio[0].tags).toEqual([{ name: 'template', value: 'order_canceled_seller' }]);
    expect(String(alNegozio[0].text)).toContain('non era in casa');
    expect(String(alNegozio[0].text)).toContain(`#${ID.slice(0, 6).toUpperCase()}`);
  });

  it('la campanella al negozio resta', async () => {
    await tocca();
    const righe = (db.notifiche[0] ?? []) as Array<{ user_id: string }>;
    expect(righe.some((r) => r.user_id === 'negozio-1')).toBe(true);
  });

  it('un ordine senza negozio non manda email a nessun negozio', async () => {
    db.ordine.seller_id = null;
    expect(await tocca()).toBe(200);
    expect(posta.inviate.filter((m) => m.to === 'negozio@esempio.it')).toHaveLength(0);
  });
});
