import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Webhook Stripe — verifica della FIRMA (PCI / integrita').
 * Un webhook con firma non valida o assente NON deve mai essere processato:
 * sarebbe un modo per falsificare pagamenti/rimborsi. Qui mockiamo
 * constructEvent per simulare il rifiuto della libreria Stripe, senza rete.
 */

// Il route legge env.stripeWebhookSecret() a runtime: basta impostarlo prima della POST.
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Stripe client: constructEvent lancia => firma non valida.
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: () => {
        throw new Error('No signatures found matching the expected signature for payload');
      },
    },
  }),
  computeApplicationFeeCents: (c: number) => Math.round((c * 800) / 10000),
  computeOrderSplit: (a: { totalCents: number; deliveryFeeCents: number; shippingCents: number }) => {
    const subtotalCents = Math.max(0, a.totalCents - a.deliveryFeeCents - a.shippingCents);
    const applicationFeeCents = Math.round((subtotalCents * 800) / 10000);
    return { subtotalCents, applicationFeeCents, sellerPayoutCents: Math.max(0, subtotalCents - applicationFeeCents) };
  },
  isStripeConfigured: () => true,
}));

// Dipendenze importate dal route (mai raggiunte su firma invalida, ma il modulo si carica).
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: vi.fn(),
  applyConnectAccountStatus: vi.fn(),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  })),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function makeReq(opts: { sig?: string; body?: string }): never {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.sig !== undefined) headers['stripe-signature'] = opts.sig;
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers,
    body: opts.body ?? '{}',
  }) as never;
}

describe('POST /api/stripe/webhook — firma', () => {
  beforeEach(() => vi.clearAllMocks());

  it('400 se la firma e invalida (constructEvent lancia)', async () => {
    const res = await POST(makeReq({ sig: 't=1,v1=deadbeef', body: '{"id":"evt_forged"}' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid signature/i);
  });

  it('503 se manca del tutto l header stripe-signature', async () => {
    const res = await POST(makeReq({ body: '{}' }));
    expect(res.status).toBe(503);
  });
});
