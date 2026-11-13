import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R10-020 — La regola firmata dice che il canone da 50 € parte solo dopo il
 * primo incasso con MyCity, e le pagine lo scrivono. La cassa invece guardava
 * solo l'approvazione: il negozio appena approvato pagava subito.
 *
 * «Primo incasso» (definizione approvata dalla regista, da confermare da Nicola):
 * un ordine del negozio pagato (PAID) o in contanti e consegnato.
 */

const stato = vi.hoisted(() => ({
  incassi: [] as Array<{ id: string }>,
  erroreIncassi: null as null | { code: string },
  filtro: '' as string,
  sessioni: 0,
}));

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  ABBONAMENTO_NEGOZI_ACCESO: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (c: Record<string, unknown>) => unknown) => (req: Request) =>
    h({ user: { id: 's1', email: 'negozio@example.com' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', async (orig) => ({
  ...(await orig<typeof import('@/lib/env')>()),
  env: { ...(await orig<typeof import('@/lib/env')>()).env, appUrl: () => 'http://localhost' },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: (tabella: string) => tabella === 'orders'
      ? { select: () => ({ eq: (_c: string, v: string) => ({ or: (f: string) => {
          stato.filtro = `${v}|${f}`;
          return { limit: async () => ({ data: stato.erroreIncassi ? null : stato.incassi, error: stato.erroreIncassi }) };
        } }) }) }
      : { select: () => ({ eq: () => ({ single: async () => ({
          data: { role: 'seller', is_approved: true, stripe_customer_id: null, subscription_status: null }, error: null,
        }) }) }) },
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    subscriptions: { list: async () => ({ data: [] }) },
    checkout: { sessions: { create: async () => { stato.sessioni += 1; return { url: 'https://cassa' }; } } },
  }),
}));

const { POST } = await import('@/app/api/seller/subscription/checkout/route');
const apri = async () => {
  const r = await (POST as unknown as (q: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return { status: r.status, testo: JSON.stringify(await r.json()) };
};

beforeEach(() => {
  stato.incassi = [];
  stato.erroreIncassi = null;
  stato.filtro = '';
  stato.sessioni = 0;
});

describe('R10-020 — il canone parte dopo il primo incasso', () => {
  it('negozio approvato senza incassi: niente cassa, e il motivo detto a parole', async () => {
    const r = await apri();
    expect(r.status, 'il negozio appena approvato può pagare 50 € subito').toBe(403);
    expect(r.testo).toMatch(/primo incasso/);
    expect(stato.sessioni).toBe(0);
  });

  it('negozio con un incasso: la cassa si apre', async () => {
    stato.incassi = [{ id: 'o1' }];
    expect((await apri()).status).toBe(200);
    expect(stato.sessioni).toBe(1);
    expect(stato.filtro).toBe('s1|payment_status.in.(PAID,PARTIALLY_REFUNDED),and(payment_method.eq.cod,delivery_status.eq.DELIVERED)');
  });

  it('un ordine pagato e poi rimborsato in parte conta come incasso', async () => {
    stato.incassi = [{ id: 'o1' }];
    await apri();
    expect(stato.filtro, 'il rimborso parziale cancella l’incasso').toContain('PARTIALLY_REFUNDED');
  });

  it('incassi non letti: non si chiede di pagare alla cieca', async () => {
    stato.erroreIncassi = { code: '57014' };
    expect((await apri()).status).toBe(503);
    expect(stato.sessioni).toBe(0);
  });
});
