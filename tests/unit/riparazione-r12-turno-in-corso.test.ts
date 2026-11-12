/**
 * R12-018 — Un avviso di Stripe mai lavorato, col turno preso da una consegna
 * morta da meno di cinque minuti, riceveva 200 «già visto» e si perdeva:
 * Stripe smetteva di riprovare. Su un checkout pagato vuol dire cliente
 * addebitato e ordine mai nato. Qui: solo un avviso già lavorato è «già
 * visto»; uno in corso risponde 409 e Stripe riproverà.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const stato = {
  riga: { event_id: 'evt_r12', processed: false, claimed_at: '' } as { event_id: string; processed: boolean; claimed_at: string | null },
  gestiti: 0,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => ({ id: 'evt_r12', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_1' } } }) },
  }),
}));
vi.mock('@/lib/stripe/webhook', async (orig) => {
  const vero = await orig<Record<string, unknown>>();
  return { ...vero, handlePaymentFailed: vi.fn(async () => { stato.gestiti += 1; }) };
});

/** Un registro finto che applica i filtri come PostgREST: una riga sola. */
function catenaUpdate(valori: Record<string, unknown>) {
  const filtri: Array<(r: typeof stato.riga) => boolean> = [];
  const c = {
    eq(col: string, v: unknown) { filtri.push((r) => (r as Record<string, unknown>)[col] === v); return c; },
    is(col: string, v: unknown) { filtri.push((r) => (r as Record<string, unknown>)[col] === v); return c; },
    lt(col: string, v: string) { filtri.push((r) => { const x = (r as Record<string, unknown>)[col]; return typeof x === 'string' && x < v; }); return c; },
    select() {
      const ok = filtri.every((f) => f(stato.riga));
      if (ok) Object.assign(stato.riga, valori);
      return Promise.resolve({ data: ok ? [{ event_id: stato.riga.event_id }] : [], error: null });
    },
    then(res: (v: unknown) => unknown) {
      if (filtri.every((f) => f(stato.riga))) Object.assign(stato.riga, valori);
      return Promise.resolve({ error: null }).then(res);
    },
  };
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'stripe_event_log') {
        return {
          insert: () => Promise.resolve({ error: { code: '23505' } }),
          update: catenaUpdate,
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { processed: stato.riga.processed }, error: null }) }) }),
        };
      }
      return { insert: () => Promise.resolve({ error: null }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    },
  })),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function richiesta(): never {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=x' },
    body: '{}',
  }) as never;
}

beforeEach(() => {
  stato.gestiti = 0;
});

describe('R12-018 un avviso in corso non è «già visto»', () => {
  it('turno preso un minuto fa da una consegna (forse morta), mai lavorato: Stripe deve riprovare', async () => {
    stato.riga = { event_id: 'evt_r12', processed: false, claimed_at: new Date(Date.now() - 60_000).toISOString() };
    const res = await POST(richiesta());
    expect(res.status, 'con un 2xx Stripe dà l avviso per consegnato e non lo rimanda più').toBeGreaterThanOrEqual(400);
    expect(stato.gestiti, 'il gestore non parte mentre un altro ha il turno').toBe(0);
  });

  it('avviso già lavorato: 200 «già visto», come prima', async () => {
    stato.riga = { event_id: 'evt_r12', processed: true, claimed_at: new Date(Date.now() - 60_000).toISOString() };
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect((await res.json()).duplicated).toBe(true);
    expect(stato.gestiti).toBe(0);
  });
});
