import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il portale dell'abbonamento non si apre a chi ha solo il cliente Stripe (nato al
 * primo clic su «attiva», cassa abbandonata) senza un abbonamento. Supabase e Stripe finti.
 */

const stato = vi.hoisted(() => ({ profilo: {} as Record<string, unknown>, aperto: 0 }));

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  ABBONAMENTO_NEGOZI_ACCESO: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (c: Record<string, unknown>) => unknown) => (req: Request) =>
    h({ user: { id: 'seller-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'http://localhost' } }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    billingPortal: { sessions: { create: async () => { stato.aperto += 1; return { url: 'https://portale' }; } } },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: stato.profilo, error: null }) }) }) }),
  }),
}));

const { POST } = await import('@/app/api/seller/subscription/portal/route');
const apri = () => (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));

beforeEach(() => { stato.aperto = 0; });

describe('portale: serve un abbonamento, non basta il cliente Stripe', () => {
  it.each([['none'], [null], ['inactive']])('cliente Stripe con stato %s: rifiutato e Stripe non si chiama', async (s) => {
    stato.profilo = { stripe_customer_id: 'cus_1', subscription_status: s };
    const r = await apri();
    expect(r.status).toBe(400);
    expect(stato.aperto).toBe(0);
  });
  it('abbonamento attivo: il portale si apre', async () => {
    stato.profilo = { stripe_customer_id: 'cus_1', subscription_status: 'active' };
    const r = await apri();
    expect(r.status).toBe(200);
    expect(stato.aperto).toBe(1);
  });
});
