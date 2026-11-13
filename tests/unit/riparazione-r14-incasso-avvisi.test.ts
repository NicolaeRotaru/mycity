import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R14-020 — gli avvisi «incasso in contanti che non quadra» e «incasso senza foto» guardano se
 * sono partiti (app/api/rider/cash-confirm/route.ts).
 *
 * Il caso: un fattorino dichiara 30 € su un ordine da 42 €. Se la lettura degli amministratori
 * cade, o la campanella non si scrive, prima non lo sapeva nessuno: la rotta non leggeva gli
 * esiti. L'incasso resta registrato (il fattorino non è la persona a cui dirlo), ma l'avviso
 * mancato lascia una riga d'errore nel log col suo testo.
 */

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const state = {
  order: null as Record<string, unknown> | null,
  admins: [{ id: 'admin-1' }] as Array<{ id: string }> | null,
  erroreAdmins: null as { message: string } | null,
  erroreCampanella: null as { message: string } | null,
};
const campanelle: Array<Record<string, unknown>> = [];

function qb(result: unknown) {
  const chain = () => builder;
  const builder: Record<string, unknown> = {
    select: chain, eq: chain, is: chain, in: chain, gte: chain, lte: chain, lt: chain, order: chain, limit: chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (ctx: { user: { id: string }; req: unknown }) => unknown) => (req: unknown) =>
    h({ user: { id: 'rider-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/cassa/quadratura', () => ({ aggiornaQuadratura: vi.fn(async () => undefined) }));
vi.mock('@/lib/cassa/registra-incasso', async (orig) => ({
  ...(await orig<typeof import('@/lib/cassa/registra-incasso')>()),
  tracciaIncassoSenzaFoto: vi.fn(async () => undefined),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => qb({ data: state.order, error: null }),
          update: () => qb({ data: [{ id: ORDER_ID }], error: null }),
        };
      }
      if (table === 'profiles') return { select: () => qb({ data: state.erroreAdmins ? null : state.admins, error: state.erroreAdmins }) };
      if (table === 'notifications') {
        return {
          insert: (righe: Array<Record<string, unknown>>) => {
            if (!state.erroreCampanella) campanelle.push(...righe);
            return Promise.resolve({ error: state.erroreCampanella });
          },
        };
      }
      return { select: () => qb({ data: [], error: null }) };
    },
  }),
}));

import { logger } from '@/lib/logger';

async function conferma(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/rider/cash-confirm/route');
  const req = new Request('http://localhost/api/rider/cash-confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (POST as unknown as (r: Request) => Promise<Response>)(req);
}

const erroriDelLog = () => vi.mocked(logger.error).mock.calls.map((c) => String(c[0]));

function ordine(totale: number): Record<string, unknown> {
  return {
    id: ORDER_ID, rider_id: 'rider-1', total_price: totale, rider_fee_cents: 300, shipping_cost: 0,
    pickup_in_store: false, payment_method: 'cod', payment_status: 'PENDING', delivery_status: 'DELIVERED',
    cash_confirmed_at: null, wallet_applied_cents: 0,
  };
}

beforeEach(() => {
  campanelle.length = 0;
  vi.mocked(logger.error).mockClear();
  state.admins = [{ id: 'admin-1' }];
  state.erroreAdmins = null;
  state.erroreCampanella = null;
});

describe('R14-020 — l incasso che non quadra', () => {
  // 45 € di ordine, 3 € al fattorino: da rimettere 42 €. Dichiarati 30 €.
  const nonQuadra = { orderId: ORDER_ID, cashCollectedCents: 3000 };

  it('campanella scritta: nessun errore, l incasso è registrato', async () => {
    state.order = ordine(45);
    const res = await conferma(nonQuadra);
    expect(res.status).toBe(200);
    expect(campanelle.map((c) => c.title)).toEqual(['⚠️ Incasso COD non quadra']);
    expect(campanelle[0].category).toBe('system');
    expect(erroriDelLog().some((m) => /NON partito/.test(m))).toBe(false);
  });

  it('la campanella rifiutata non passa in silenzio', async () => {
    state.order = ordine(45);
    state.erroreCampanella = { message: 'permission denied for table notifications' };
    const res = await conferma(nonQuadra);
    expect(res.status).toBe(200);
    expect(erroriDelLog().some((m) => m.includes('Incasso COD non quadra') && /NON partito/.test(m)),
      'avviso dell incasso che non quadra perso senza traccia').toBe(true);
  });

  it('gli amministratori non letti non passano in silenzio', async () => {
    state.order = ordine(45);
    state.erroreAdmins = { message: 'canceling statement due to statement timeout' };
    const res = await conferma(nonQuadra);
    expect(res.status).toBe(200);
    expect(erroriDelLog().some((m) => m.includes('Incasso COD non quadra') && /amministratori non letti/.test(m))).toBe(true);
  });

  it('nessun amministratore: l avviso non arriva a nessuno, e si dice', async () => {
    state.order = ordine(45);
    state.admins = [];
    await conferma(nonQuadra);
    expect(erroriDelLog().some((m) => m.includes('Incasso COD non quadra') && /nessun amministratore/.test(m))).toBe(true);
  });
});

describe('R14-020 — l incasso senza foto', () => {
  // 60 € di ordine, da rimettere 57 €: sopra i 50 € serve la foto, o una nota.
  const senzaFoto = { orderId: ORDER_ID, cashCollectedCents: 5700, nota: 'telefono scarico, niente foto' };

  it('campanella scritta: nessun errore', async () => {
    state.order = ordine(60);
    const res = await conferma(senzaFoto);
    expect(res.status).toBe(200);
    expect(campanelle.map((c) => c.title)).toEqual(['📷 Incasso senza foto']);
  });

  it('la campanella rifiutata non passa in silenzio', async () => {
    state.order = ordine(60);
    state.erroreCampanella = { message: 'permission denied for table notifications' };
    const res = await conferma(senzaFoto);
    expect(res.status).toBe(200);
    expect(erroriDelLog().some((m) => m.includes('Incasso senza foto') && /NON partito/.test(m)),
      'avviso dell incasso senza foto perso senza traccia').toBe(true);
  });
});
