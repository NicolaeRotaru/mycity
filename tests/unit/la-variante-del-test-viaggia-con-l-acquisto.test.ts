import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 27/8/2026 (R165) — L'ESPERIMENTO NON ERA MISURABILE, CIOÈ NON ERA UN
 * ESPERIMENTO.
 *
 * La variante della home si attacca a tutti gli eventi del browser con una
 * super-property di PostHog. Ma l'acquisto NON parte dal browser: lo manda il
 * server, con un elenco chiuso di proprietà scritte a mano — e lì la variante
 * non c'era. Si sapeva chi aveva visto quale home, non chi di quelli aveva poi
 * comprato: l'analisi andava fatta a mano, legando le persone una a una.
 *
 * Adesso la variante viaggia dal cookie fino all'evento, con lo stesso nome che
 * usa il browser (`home_hero_variant`), così l'acquisto si filtra come tutti
 * gli altri eventi.
 */

const inviato: Array<{ url: string; corpo: Record<string, unknown> }> = [];
const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

beforeEach(() => {
  inviato.length = 0;
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    inviato.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('{"status":1}', { status: 200 });
  }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const acquisto = {
  orderId: '11111111-1111-1111-1111-111111111111',
  buyerId: 'cliente-1',
  totalCents: 3400,
  paymentMethod: 'cod' as const,
  sellerId: 'negozio-1',
  checkoutId: 'carrello-9',
  consensoAnalytics: true,
};

describe('l acquisto contato dal server', () => {
  it('porta con se il gruppo dell esperimento, col nome che usa il browser', async () => {
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto({ ...acquisto, varianti: { home_hero: 'b' } });

    const props = inviato[0].corpo.properties as Record<string, unknown>;
    expect(
      props.home_hero_variant,
      'l acquisto arriva senza il gruppo dell esperimento: il test si puo analizzare solo a mano',
    ).toBe('b');
  });

  it('senza esperimenti in corso non aggiunge niente di inventato', async () => {
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto({ ...acquisto, varianti: {} });
    const props = inviato[0].corpo.properties as Record<string, unknown>;
    expect(Object.keys(props).some((k) => k.endsWith('_variant'))).toBe(false);
  });
});

describe('la variante letta dai cookie del checkout', () => {
  it('riconosce l assegnazione scritta dal middleware', async () => {
    const { variantiDaiCookie } = await import('@/lib/analytics/varianti-dai-cookie');
    expect(variantiDaiCookie('mc_exp_home_hero=b; altro=1')).toEqual({ home_hero: 'b' });
    expect(variantiDaiCookie('altro=1')).toEqual({});
    expect(variantiDaiCookie(null)).toEqual({});
  });

  it('non si fa dettare gruppi che non esistono', async () => {
    // Il cookie lo puo' riscrivere chiunque: se passasse com'e', nei conti
    // comparirebbero gruppi di esperimento inventati, e la variante vincente
    // sarebbe una media di cose diverse.
    const { variantiDaiCookie } = await import('@/lib/analytics/varianti-dai-cookie');
    expect(variantiDaiCookie('mc_exp_home_hero=zzz')).toEqual({});
  });
});
