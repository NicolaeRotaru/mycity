import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R30-023 — Il fattorino sospeso non registra incassi e non annulla consegne.
 *
 * Le due rotte del fattorino che leggono l'ordine col client di servizio
 * (app/api/rider/cash-confirm e app/api/rider/orders/[id]/cliente-assente) non
 * passano dalla regola di lettura del database: un fattorino sospeso
 * (is_approved=false, come lo lascia la rotta di moderazione) poteva ancora
 * dichiarare i contanti e annullare con «cliente assente» le consegne che
 * aveva in mano. Qui le rotte si montano col profilo che passa il portiere
 * (lib/api/middleware.ts): sospeso → 403 e niente scritto; approvato → come prima.
 */

const ORDINE = '11111111-2222-4333-8444-555555555555';
const RIDER = 'rider-1';

const stato = vi.hoisted(() => ({
  profilo: { id: 'rider-1', role: 'rider', is_approved: true } as { id: string; role: string; is_approved: boolean },
  ordine: {} as Record<string, unknown>,
  scritture: [] as Record<string, unknown>[],
  annulli: [] as unknown[],
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (c: Record<string, unknown>) => unknown) =>
    (req: unknown, ctx?: { params: Record<string, string> }) =>
      h({ user: { id: RIDER }, profile: { ...stato.profilo }, req, params: ctx?.params ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/cassa/quadratura', () => ({ aggiornaQuadratura: vi.fn(async () => undefined) }));
vi.mock('@/lib/rider/prova-del-fattorino', () => ({
  provaDelFattorino: async () => null,
  percorsoDelFattorino: () => null,
}));
vi.mock('@/lib/ordini/annulla', () => ({
  COLONNE_ANNULLO: 'id, user_id, seller_id, total_price, payment_method, delivery_status',
  avvisaIlNegozioDellAnnullo: vi.fn(async () => true),
  annullaERimborsa: vi.fn(async (_admin: unknown, ordine: unknown) => {
    stato.annulli.push(ordine);
    return { ok: true, refundId: null, creditoNonTornatoCents: 0 };
  }),
}));

/** Una catena che si può filtrare quanto si vuole e risponde sempre `esito`. */
function catena(esito: unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'neq', 'is', 'in', 'order', 'limit']) c[k] = () => c;
  c.maybeSingle = () => Promise.resolve(esito);
  c.single = () => Promise.resolve(esito);
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esito).then(ok, ko);
  return c;
}

const admin = {
  from: (tabella: string) => {
    if (tabella === 'orders') {
      return {
        select: () => catena({ data: { ...stato.ordine }, error: null }),
        update: (valori: Record<string, unknown>) => {
          stato.scritture.push(valori);
          return catena({ data: [{ id: ORDINE }], error: null });
        },
      };
    }
    if (tabella === 'notifications') return { insert: async () => ({ error: null }) };
    return catena({ data: [], error: null });
  },
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => admin }));

import { POST as incasso } from '@/app/api/rider/cash-confirm/route';
import { POST as clienteAssente } from '@/app/api/rider/orders/[id]/cliente-assente/route';

async function dichiaraIncasso() {
  const req = new Request('http://localhost/api/rider/cash-confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: ORDINE, cashCollectedCents: 700 }),
  });
  const res = (await (incasso as unknown as (r: Request) => Promise<Response>)(req)) as Response;
  return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
}

async function segnaClienteAssente() {
  const req = new Request(`http://localhost/api/rider/orders/${ORDINE}/cliente-assente`, { method: 'POST' });
  const res = (await (clienteAssente as unknown as (r: Request, c: { params: Record<string, string> }) => Promise<Response>)(
    req,
    { params: { id: ORDINE } },
  )) as Response;
  return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
}

const SOSPESO = { id: RIDER, role: 'rider', is_approved: false };
const APPROVATO = { id: RIDER, role: 'rider', is_approved: true };

beforeEach(() => {
  stato.scritture = [];
  stato.annulli = [];
  stato.profilo = { ...APPROVATO };
});

describe('R30-023 — il fattorino sospeso non dichiara i contanti', () => {
  beforeEach(() => {
    // Contanti da 10 euro, consegnato, incasso non ancora dichiarato.
    stato.ordine = {
      id: ORDINE,
      rider_id: RIDER,
      total_price: 10,
      rider_fee_cents: 300,
      shipping_cost: 0,
      pickup_in_store: false,
      payment_method: 'cod',
      payment_status: 'PENDING',
      delivery_status: 'DELIVERED',
      cash_confirmed_at: null,
      delivered_at: '2026-11-16T18:00:00Z',
    };
  });

  it('sospeso: 403 e sull ordine non si scrive niente', async () => {
    stato.profilo = { ...SOSPESO };
    const { status, corpo } = await dichiaraIncasso();
    expect(status).toBe(403);
    expect(JSON.stringify(corpo)).toMatch(/sospeso/);
    expect(stato.scritture).toEqual([]);
  });

  it('un profilo che non è più fattorino non dichiara nemmeno lui', async () => {
    stato.profilo = { id: RIDER, role: 'buyer', is_approved: false };
    const { status } = await dichiaraIncasso();
    expect(status).toBe(403);
    expect(stato.scritture).toEqual([]);
  });

  it('approvato: l incasso si registra come prima', async () => {
    const { status } = await dichiaraIncasso();
    expect(status).toBe(200);
    expect(stato.scritture.length).toBeGreaterThan(0);
    expect(stato.scritture[0]).toMatchObject({ cash_collected_cents: 700 });
  });
});

describe('R30-023 — il fattorino sospeso non annulla con «cliente assente»', () => {
  beforeEach(() => {
    stato.ordine = {
      id: ORDINE,
      user_id: 'cliente-1',
      seller_id: 'negozio-1',
      rider_id: RIDER,
      total_price: 18.5,
      payment_method: 'cod',
      delivery_status: 'OUT_FOR_DELIVERY',
    };
  });

  it('sospeso: 403 e nessun annullo', async () => {
    stato.profilo = { ...SOSPESO };
    const { status, corpo } = await segnaClienteAssente();
    expect(status).toBe(403);
    expect(JSON.stringify(corpo)).toMatch(/sospeso/);
    expect(stato.annulli).toEqual([]);
  });

  it('approvato: l ordine si annulla come prima', async () => {
    const { status, corpo } = await segnaClienteAssente();
    expect(status).toBe(200);
    expect(corpo).toMatchObject({ ok: true, motivo: 'cliente_assente' });
    expect(stato.annulli).toHaveLength(1);
  });
});
