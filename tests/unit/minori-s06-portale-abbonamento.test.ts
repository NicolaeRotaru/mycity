import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S06 · 2428 — Con l'abbonamento spento, chi ne ha uno in corso può ancora
 * aprire il portale per disdirlo; chi non ce l'ha riceve 503.
 */

const stato = vi.hoisted(() => ({ profilo: {} as Record<string, unknown>, aperto: 0 }));

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  ABBONAMENTO_NEGOZI_ACCESO: false,
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

describe('2428 — la porta per uscire resta aperta', () => {
  it('abbonamento attivo: il portale si apre anche a funzione spenta', async () => {
    stato.profilo = { stripe_customer_id: 'cus_1', subscription_status: 'active' };
    const r = await apri();
    expect(r.status).toBe(200);
    expect(stato.aperto).toBe(1);
  });
  it('nessun abbonamento in corso: 503 e Stripe non si chiama', async () => {
    stato.profilo = { stripe_customer_id: 'cus_1', subscription_status: 'canceled' };
    expect((await apri()).status).toBe(503);
    expect(stato.aperto).toBe(0);
  });
});
