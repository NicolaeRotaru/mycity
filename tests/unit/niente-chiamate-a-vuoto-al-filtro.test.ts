import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 27/8/2026 (R152) — SI PAGAVA UNA CHIAMATA AL MODELLO PER SCOPRIRE CHE NON
 * C'ERA NIENTE DA CONTROLLARE.
 *
 * Nel copilot il filtro anti-contenuti girava alla riga 104 e il controllo
 * «l'istruzione e' vuota» alla 114, dieci righe piu' sotto. Stesso ordine
 * sbagliato nel dettato vocale. E `assertSafeText` non ha nessuna uscita rapida
 * sul testo vuoto: parte comunque una chiamata al modello, da 128 token, per
 * poi rifiutare subito dopo.
 *
 * Non e' un buco: e' sciatteria che si paga a consumo, venticinque volte
 * all'ora per venditore, e un modo gratuito per far partire chiamate a vuoto.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) },
  }),
}));

const filtroChiamato = vi.fn(async () => undefined);
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: (...a: unknown[]) => filtroChiamato(...(a as [])) };
});
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: vi.fn() };
});

import { POST as COPILOT } from '@/app/api/ai/copilot/route';
import { POST as VOICE } from '@/app/api/ai/voice-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function richiesta(url: string, corpo: unknown): never {
  return new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  }) as never;
}

describe('il filtro non si chiama quando non c e niente da filtrare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('copilot: istruzione vuota, nessuna chiamata a pagamento', async () => {
    const res = await COPILOT(richiesta('http://localhost/api/ai/copilot', { instruction: '   ' }));
    expect(res.status).toBe(400);
    expect(
      filtroChiamato,
      'per scoprire che l istruzione era vuota si e pagata una chiamata al modello',
    ).not.toHaveBeenCalled();
  });

  it('dettato vocale: due lettere non bastano, e non costano niente', async () => {
    const res = await VOICE(richiesta('http://localhost/api/ai/voice-product', { transcript: 'ah' }));
    expect(res.status).toBe(400);
    expect(filtroChiamato).not.toHaveBeenCalled();
  });

  it('quando invece qualcosa da controllare c e, il filtro parte', async () => {
    await COPILOT(
      richiesta('http://localhost/api/ai/copilot', { instruction: 'abbassa del 10% l elettronica' }),
    );
    expect(filtroChiamato).toHaveBeenCalledTimes(1);
  });
});
