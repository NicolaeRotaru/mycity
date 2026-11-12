import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R10-005 — Il prezzo dell'abbonamento era scritto a mano in sei posti, e uno
 * era l'addebito vero (5000 centesimi nella cassa). La prova di prima guardava
 * solo le frasi: se cambiava l'addebito non se ne accorgeva.
 *
 * Qui il prezzo nella fonte unica (app/seller/earnings/commissione.ts) è finto,
 * 60 €: la cassa deve chiedere a Stripe 6000 centesimi e il banner deve dire
 * €60. Con un numero scritto a mano da qualche parte la prova diventa rossa.
 */

const stato = vi.hoisted(() => ({ parametri: null as null | Record<string, any> }));

vi.mock('@/app/seller/earnings/commissione', async (orig) => ({
  ...(await orig<typeof import('@/app/seller/earnings/commissione')>()),
  ABBONAMENTO_CENTESIMI_MESE: 6000,
  PREZZO_ABBONAMENTO_MESE: '€60',
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
      // Un negozio che ha già incassato (R10-020): la cassa si apre.
      ? { select: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: [{ id: 'o1' }], error: null }) }) }) }) }
      : { select: () => ({ eq: () => ({ single: async () => ({
        data: { role: 'seller', is_approved: true, stripe_customer_id: null, subscription_status: null }, error: null,
      }) }) }) },
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    subscriptions: { list: async () => ({ data: [] }) },
    checkout: { sessions: { create: async (p: Record<string, any>) => { stato.parametri = p; return { url: 'https://cassa' }; } } },
  }),
}));

describe('R10-005 — un prezzo solo, anche per l’addebito', () => {
  it('la cassa chiede a Stripe l’importo della fonte unica', async () => {
    const { POST } = await import('@/app/api/seller/subscription/checkout/route');
    const r = await (POST as unknown as (q: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
    expect(r.status).toBe(200);
    const riga = stato.parametri?.line_items?.[0]?.price_data;
    expect(riga?.unit_amount, 'la cassa addebita un importo scritto a mano').toBe(6000);
    expect(riga?.product_data?.description).toContain('€60/mese');
  });

  it('il banner dice il prezzo della fonte unica', async () => {
    const { SubscriptionBanner } = await import('@/components/seller/SubscriptionBanner');
    const html = renderToStaticMarkup(createElement(SubscriptionBanner, { status: 'none' }));
    expect(html).toContain('€60/mese');
    expect(html).not.toContain('€50');
  });

  it('il modulo di richiesta del negozio dice il prezzo della fonte unica', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('components/SellerApplicationForm.tsx', 'utf8');
    expect(src, 'il modulo ha di nuovo un prezzo suo').not.toMatch(/const PREZZO_ABBONAMENTO_MESE\s*=/);
  });
});
