import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 24/11/2026 — Gli abbonamenti dei servizi (MyCity tramite SDG) vivono in `abbonamenti_servizi`.
 * Un loro cambio di stato o una loro fattura rifiutata si scrive lì, e non tocca mai
 * l'abbonamento della vetrina sul profilo. Un abbonamento che non è dei servizi passa come prima.
 */

const stato = vi.hoisted(() => ({
  scritture: [] as { tabella: string; valori: unknown; filtro: [string, unknown] | null }[],
  rigaServizi: null as null | { seller_id: string; fascia: string },
  erroreServizi: null as null | { code: string; message: string },
  statoStripe: 'past_due' as 'active' | 'past_due' | 'canceled',
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: async () => ({ status: stato.statoStripe, current_period_end: 1_800_000_000 }),
      list: async () => ({ data: [] }),
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const c: Record<string, unknown> = {};
      let filtro: [string, unknown] | null = null;
      let valori: unknown = null;
      let scrive = false;
      const risultato = () => {
        if (scrive) stato.scritture.push({ tabella, valori, filtro });
        return { data: [], error: null };
      };
      c.select = () => c;
      c.eq = (col: string, v: unknown) => { filtro = filtro ?? [col, v]; return c; };
      c.update = (v: unknown) => { scrive = true; valori = v; return c; };
      c.insert = (v: unknown) => { scrive = true; valori = v; return Promise.resolve(risultato()); };
      c.maybeSingle = async () => (tabella === 'abbonamenti_servizi'
        ? { data: stato.erroreServizi ? null : stato.rigaServizi, error: stato.erroreServizi }
        : { data: null, error: null });
      c.then = (ok: (x: unknown) => unknown) => Promise.resolve(risultato()).then(ok);
      return c;
    },
  }),
}));

const { handleSubscriptionChanged, handleInvoicePaymentFailed } = await import('@/lib/stripe/webhook/abbonamenti');

beforeEach(() => {
  stato.scritture = [];
  stato.rigaServizi = null;
  stato.erroreServizi = null;
  stato.statoStripe = 'past_due';
});

describe('i cambi degli abbonamenti dei servizi', () => {
  it('un cambio di stato dei servizi si scrive nella loro tabella, non sul profilo', async () => {
    stato.statoStripe = 'canceled';
    await handleSubscriptionChanged({ id: 'sub_servizi', metadata: { kind: 'servizi_subscription' } } as never);
    expect(stato.scritture.map((w) => w.tabella)).toEqual(['abbonamenti_servizi']);
    expect(stato.scritture[0].valori).toMatchObject({ stato: 'canceled' });
    expect(stato.scritture[0].filtro).toEqual(['stripe_subscription_id', 'sub_servizi']);
  });

  it('un cambio di stato della vetrina va sul profilo, come prima', async () => {
    await handleSubscriptionChanged({ id: 'sub_vetrina', metadata: { kind: 'seller_subscription' } } as never);
    expect(stato.scritture.map((w) => w.tabella)).toEqual(['profiles']);
  });

  it('una fattura dei servizi rifiutata segna il ritardo e avvisa il negozio, senza toccare il profilo', async () => {
    stato.rigaServizi = { seller_id: 'negozio-1', fascia: 'business' };
    await handleInvoicePaymentFailed({ id: 'in_1', customer: 'cus_servizi', subscription: 'sub_servizi' } as never);
    expect(stato.scritture.map((w) => w.tabella)).toEqual(['abbonamenti_servizi', 'notifications']);
    expect(stato.scritture[0].valori).toMatchObject({ stato: 'past_due' });
    expect(stato.scritture[1].valori).toMatchObject({ user_id: 'negozio-1', link: '/seller/abbonamento' });
  });

  it('se nel frattempo è stata pagata, non scrive e non avvisa', async () => {
    stato.rigaServizi = { seller_id: 'negozio-1', fascia: 'business' };
    stato.statoStripe = 'active';
    await handleInvoicePaymentFailed({ id: 'in_1', customer: 'cus_servizi', subscription: 'sub_servizi' } as never);
    expect(stato.scritture).toEqual([]);
  });

  it('una fattura che non è dei servizi, o con la tabella ancora assente, passa alla vetrina', async () => {
    await handleInvoicePaymentFailed({ id: 'in_2', customer: 'cus_vetrina', subscription: 'sub_vetrina' } as never);
    expect(stato.scritture[0]?.tabella).toBe('profiles');
    stato.scritture = [];
    stato.erroreServizi = { code: '42P01', message: 'relation "abbonamenti_servizi" does not exist' };
    await handleInvoicePaymentFailed({ id: 'in_3', customer: 'cus_vetrina', subscription: 'sub_vetrina' } as never);
    expect(stato.scritture[0]?.tabella).toBe('profiles');
  });

  it('un altro guasto di lettura fa riprovare Stripe invece di decidere a caso', async () => {
    stato.erroreServizi = { code: '57014', message: 'timeout' };
    await expect(handleInvoicePaymentFailed({ id: 'in_4', customer: 'c', subscription: 'sub_x' } as never)).rejects.toThrow(/non letto/);
  });
});
