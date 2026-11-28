import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 28/11/2026 (onda 2, R05-009) — IL FRENO DEL CONTO DI PROVA VALE DOVUNQUE GIRI UNA CHIAVE DI PROVA.
 *
 * Una chiave Stripe di prova non conosce i conti veri: `accounts.retrieve` sul conto vero del negozio
 * risponde «No such account». Il freno (non sostituirlo con un conto di prova) scattava solo con
 * VERCEL_ENV === 'preview': lo sviluppo in locale, o un ambiente di prova col database vero, creavano un
 * conto di prova e lo scrivevano sul profilo al posto di quello vero, e il negozio non riceveva più i
 * bonifici. E la frase per la persona diceva «in questa anteprima», mentre «Aggiorna stato» nello stesso
 * caso rispondeva 500 «Errore Stripe».
 *
 * Qui le rotte vere e il modulo vero di lib/stripe/client, con la libreria Stripe finta sotto.
 */
const st = vi.hoisted(() => ({
  creati: 0,
  salvati: [] as string[],
  profilo: { approval_status: 'approved', stripe_account_id: 'acct_vero_del_negozio' as string | null, store_name: 'Forno' },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => {
  const conUtente = (_o: unknown, h: (c: Record<string, unknown>) => unknown) => () =>
    h({ user: { id: 'forno', email: 'forno@esempio.it' }, profile: { role: 'rider' } });
  return { withSellerAuthRateLimit: conUtente, withAuthRateLimit: conUtente };
});
vi.mock('stripe', () => ({
  default: class {
    accounts = {
      create: async () => ((st.creati += 1), { id: 'acct_di_prova_nuovo' }),
      // Il conto vero del negozio: la chiave in uso non lo conosce.
      retrieve: async (id: string) => {
        throw Object.assign(new Error(`No such account: '${id}'`), { code: 'resource_missing', statusCode: 404 });
      },
    };
    accountLinks = { create: async () => ({ url: 'https://connect.stripe.test/onboarding' }) };
  },
}));
vi.mock('@/lib/supabase/server', () => {
  const update = (v: Record<string, unknown>) => {
    const q: Record<string, unknown> = {};
    q.eq = () => q;
    q.select = async () => {
      if (v.stripe_account_id) st.salvati.push(String(v.stripe_account_id));
      return { data: [{ id: 'forno' }], error: null };
    };
    return q;
  };
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: st.profilo, error: null }) }) }), update }),
  };
  return { getServerSupabase: async () => client, getAdminSupabase: () => client };
});

import { friendlyError } from '@/lib/errors';
import { POST as collegaNegozio } from '@/app/api/stripe/connect/onboarding/route';
import { POST as collegaFattorino } from '@/app/api/stripe/connect/rider-onboarding/route';
import { POST as aggiornaStato } from '@/app/api/stripe/connect/refresh-status/route';

const chiama = async (f: unknown) => {
  const r = await (f as () => Promise<Response>)();
  return { status: r.status, corpo: (await r.json()) as { error?: { message?: string }; url?: string } };
};

beforeEach(() => {
  st.creati = 0;
  st.salvati = [];
  st.profilo = { approval_status: 'approved', stripe_account_id: 'acct_vero_del_negozio', store_name: 'Forno' };
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_finta');
});
afterEach(() => vi.unstubAllEnvs());

describe('R05-009 — il freno del conto di prova non vale solo nell anteprima', () => {
  it.each([
    ['sviluppo in locale (VERCEL_ENV vuota)', undefined],
    ['vercel dev (development)', 'development'],
  ])('%s, chiave di prova, conto vero sul profilo: niente conto di prova al suo posto, e la persona sa cosa fare', async (_dove, ambiente) => {
    vi.stubEnv('VERCEL_ENV', ambiente);
    for (const rotta of [collegaNegozio, collegaFattorino]) {
      const r = await chiama(rotta);
      expect(r.status, 'fuori dall anteprima il conto vero è stato sostituito da uno di prova').toBe(409);
      const frase = r.corpo.error?.message ?? '';
      expect(frase).toMatch(/togli il conto dal profilo e riprova/);
      expect(frase, 'la frase parla di anteprima anche dove non lo è').not.toMatch(/anteprima/i);
      expect(frase).not.toMatch(/acct_|sk_test|rk_test/);
      expect(friendlyError(new Error(frase))).toBe(frase);
    }
    expect(st.creati).toBe(0);
    expect(st.salvati).toEqual([]);
  });

  it('«Aggiorna stato» nello stesso caso dice la stessa cosa, non 500 «Errore Stripe»', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const r = await chiama(aggiornaStato);
    expect(r.status).toBe(409);
    expect(r.corpo.error?.message).toMatch(/togli il conto dal profilo e riprova/);
  });

  it('controprova: con la chiave vera un conto sconosciuto si rifà come prima', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_finta');
    const r = await chiama(collegaNegozio);
    expect(r.status).toBe(200);
    expect(st.creati).toBe(1);
    expect(st.salvati).toEqual(['acct_di_prova_nuovo']);
  });

  it('controprova: con la chiave vera «Aggiorna stato» su un conto sconosciuto resta un guasto (500)', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_finta');
    const r = await chiama(aggiornaStato);
    expect(r.status).toBe(500);
  });
});
