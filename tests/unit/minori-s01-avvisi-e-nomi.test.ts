import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S01 — avvisi agli amministratori e nomi.
 *  · 1690: se la lettura degli amministratori cade, l'avviso sui soldi lascia una riga nel log.
 *  · 32: gli avvisi agli amministratori sono 'system', non si spengono con «Aggiornamenti ordini».
 *  · 1976: la voce della consegna su Stripe si chiama come in cassa (VOCE_CONSEGNA).
 *  · 2572 / 2483: i commenti dicono la regola vera (IVA inclusa; «un'ora» è il conto Stripe).
 */
const st = vi.hoisted(() => ({ letturaCade: false, inseriti: [] as Array<Record<string, unknown>> }));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: log }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) =>
      t === 'profiles'
        ? { select: () => ({ eq: async () => (st.letturaCade ? { data: null, error: { message: 'timeout' } } : { data: [{ id: 'nicola' }], error: null }) }) }
        : { insert: async (righe: Array<Record<string, unknown>>) => (st.inseriti.push(...righe), { error: null }) },
  }),
}));
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

beforeEach(() => {
  st.letturaCade = false;
  st.inseriti = [];
  log.error.mockClear();
});

describe('1690 — l avviso che non parte lascia traccia', () => {
  it('lettura degli amministratori caduta: logger.error col titolo', async () => {
    st.letturaCade = true;
    await notifyAdmins('⚠️ Rimborso respinto', 'va rimborsato in un altro modo', '/admin/orders');
    expect(log.error).toHaveBeenCalled();
    expect(JSON.stringify(log.error.mock.calls[0])).toContain('Rimborso respinto');
  });
});

describe('32 — gli avvisi sui soldi sono avvisi di servizio', () => {
  it('senza chiave: category system', async () => {
    await notifyAdmins('t', 'b', '/admin');
    expect(st.inseriti[0]).toMatchObject({ category: 'system', user_id: 'nicola' });
  });
  it('con unaVoltaPer: category system', async () => {
    await notifyAdmins('t', 'b', '/admin', { unaVoltaPer: 'k1' });
    expect(st.inseriti[0]).toMatchObject({ category: 'system' });
  });
});

describe('1976 / 2572 / 2483 — nomi e commenti', () => {
  const client = readFileSync('lib/stripe/client.ts', 'utf8');
  it('la voce della consegna su Stripe usa VOCE_CONSEGNA', () => {
    expect(client).not.toContain('Costo di consegna');
    expect(client).toContain('name: `${VOCE_CONSEGNA} — ${g.storeName}`');
  });
  it('il commento della commissione non dice «IVA esclusa»', () => {
    expect(client).not.toContain('IVA esclusa');
  });
  it('tempi-bonifico dice che l ora è il passaggio sul conto Stripe, non la banca', () => {
    const t = readFileSync('lib/stripe/tempi-bonifico.ts', 'utf8');
    expect(t).not.toContain("paghiamo entro\n * un'ora dalla consegna");
    expect(t).toMatch(/conto Stripe/);
  });
});

describe('75 — le chiavi di prova non girano sul sito vero', () => {
  it('chiaveStripeFuoriPosto', async () => {
    const { chiaveStripeFuoriPosto } = await import('@/lib/stripe/client');
    expect(chiaveStripeFuoriPosto('sk_test_x', 'production')).not.toBeNull();
    expect(chiaveStripeFuoriPosto('sk_live_x', 'preview')).not.toBeNull();
    expect(chiaveStripeFuoriPosto('sk_live_x', 'production')).toBeNull();
    expect(chiaveStripeFuoriPosto('sk_test_x', 'preview')).toBeNull();
    expect(chiaveStripeFuoriPosto('sk_test_x', undefined)).toBeNull();
  });
  it('isStripeConfigured è falso con sk_test_ in produzione', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_finta');
    vi.stubEnv('VERCEL_ENV', 'production');
    const { isStripeConfigured } = await import('@/lib/stripe/client');
    expect(isStripeConfigured()).toBe(false);
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(isStripeConfigured()).toBe(true);
    vi.unstubAllEnvs();
  });
});
