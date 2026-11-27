import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R03-002 — Con la carta, l'email «Nuovo ordine» rifiutata da Resend entra in coda per il negozio.
 *
 * La prova passa dal webhook vero e dal `sendEmail` vero: Resend è finto e rifiuta (quota superata).
 * Prima l'email al negozio era persa: restava solo l'avviso agli amministratori. Adesso ogni negozio
 * del carrello ha la sua riga in `email_queue`, che il giro send-emails riprova.
 */

const dopoLaRisposta: Array<() => Promise<void>> = [];
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { dopoLaRisposta.push(fn); },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));

const stato = vi.hoisted(() => ({
  coda: [] as Array<Record<string, unknown>>,
  tentati: [] as string[],
  ordiniCreati: 0,
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string }) => {
        stato.tentati.push(String(payload.to));
        return { data: null, error: { name: 'daily_quota_exceeded', message: 'You have reached your daily email quota' } };
      },
    };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: () => ({ subject: 'Ordine confermato', html: '<p>grazie</p>', text: 'grazie' }),
  newOrderSellerTemplate: () => ({ subject: 'Nuovo ordine', html: '<p>hai un ordine</p>', text: 'hai un ordine' }),
}));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => true, contaAcquisto: async () => {} }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

const gruppo = (n: number) => ({
  sellerId: `seller-${n}`, storeName: `Negozio ${n}`, totalCents: 1000, shippingCents: 0, deliveryFeeCents: 0,
  riderFeeCents: 100, couponPortionCents: 0, pickupPortionCents: 0,
  items: [{ productId: `p${n}`, quantity: 1, unitAmountCents: 1000 }],
});
const PENDING = {
  id: 'pc_1', buyer_id: 'buyer-1', status: 'PENDING', total_cents: 2000, stripe_session_id: 'cs_1', coupon_code: null,
  pickup_in_store: false,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
  groups: [gruppo(1), gruppo(2)],
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => tabella === 'email_queue' ? ({
      insert: async (riga: Record<string, unknown>) => { stato.coda.push(riga); return { error: null }; },
    }) : ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          single: async () => ({ data: PENDING, error: null }),
          maybeSingle: async () => ({ data: PENDING, error: null }),
          then: undefined,
        }),
      }),
      insert: () => {
        stato.ordiniCreati += 1;
        const esito = { data: { id: `o${stato.ordiniCreati}` }, error: null };
        return { select: () => ({ single: async () => esito }), then: (r: (v: { error: null }) => unknown) => r({ error: null }) };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@negozio.test` } } }) } },
  }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', amount_total: 2000, payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' }, metadata: {},
} as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  stato.coda.length = 0;
  stato.tentati.length = 0;
  stato.ordiniCreati = 0;
  dopoLaRisposta.length = 0;
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('RESEND_FROM', 'MyCity <ordini@mycity.example>');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('R03-002 — carta: «Nuovo ordine» rifiutata, la coda la rimanda', () => {
  it('ogni negozio del carrello ha la sua email in coda, con oggetto e corpo pronti', async () => {
    await handleCheckoutCompleted(sessione);
    for (const lavoro of dopoLaRisposta) await lavoro();

    expect(stato.tentati, 'il webhook non ha nemmeno provato a spedire al negozio').toContain('seller-1@negozio.test');
    const perNegozio = (id: string) => stato.coda.filter((r) => r.user_id === id);
    expect(perNegozio('seller-1'), 'l email al primo negozio e stata rifiutata e nessuno la rimanda').toHaveLength(1);
    expect(perNegozio('seller-2'), 'l email al secondo negozio e stata rifiutata e nessuno la rimanda').toHaveLength(1);
    const riga = perNegozio('seller-1')[0];
    expect(riga.template).toBe('posta_rimandata');
    expect((riga.metadata as Record<string, unknown>).subject).toBe('Nuovo ordine');
    expect((riga.metadata as Record<string, unknown>).html).toBe('<p>hai un ordine</p>');
  });
});
