import { describe, it, expect } from 'vitest';
import { messaggioSenzaDatiPersonali } from '@/lib/analytics/events';

/**
 * S10 (5/11/2026, scheda 508) — un telefono scritto con gli spazi non passa
 * intero verso PostHog e Google.
 */
describe('il telefono con gli spazi si maschera (508)', () => {
  for (const t of ['333 123 4567', '+39 333 123 45 67', '333.123.4567', '333-1234567']) {
    it(t, () => {
      const pulito = messaggioSenzaDatiPersonali(`chiamami ${t}`);
      expect(pulito).toContain('<numero>');
      expect(pulito).not.toMatch(/\d{3}/);
    });
  }
  it('una ricerca normale resta com\'è', () => {
    expect(messaggioSenzaDatiPersonali('pane 1 kg')).toBe('pane 1 kg');
    expect(messaggioSenzaDatiPersonali('focaccia 2024')).toBe('focaccia 2024');
  });
});

describe('POSTHOG_ACCESO spento ferma anche l\'acquisto mandato dal server (2413)', () => {
  it('con la chiave su Vercel e l\'interruttore spento non parte niente verso PostHog', async () => {
    const { vi } = await import('vitest');
    const chiamate: string[] = [];
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      chiamate.push(String(url));
      return new Response('{}', { status: 200 });
    }));
    vi.resetModules();
    const { POSTHOG_ACCESO } = await import('@/lib/funzioni-al-lancio');
    expect(POSTHOG_ACCESO).toBe(false);
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto({
      orderId: '11111111-1111-1111-1111-111111111111',
      buyerId: 'cliente-1',
      totalCents: 3400,
      paymentMethod: 'cod',
      sellerId: 'negozio-1',
      checkoutId: 'carrello-9',
      consensoAnalytics: true,
      varianti: {},
    } as never);
    expect(chiamate.filter((u) => u.includes('posthog'))).toEqual([]);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe('l\'email cercata non arriva a Google dentro l\'indirizzo (92)', () => {
  it('prima della pagina vista si imposta page_location ripulita per tutti gli eventi', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('components/GoogleAnalytics.tsx', 'utf8');
    const set = src.indexOf("window.gtag('set', {");
    const vista = src.indexOf("window.gtag('event', 'page_view'");
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(vista);
    expect(src.slice(set, vista)).toMatch(/page_location: window\.location\.origin \+ indirizzoCampagna/);
    expect(src.slice(set, vista)).toMatch(/page_referrer: referrerSenzaCoda\(document\.referrer\)/);
  });
  it('il referrer perde parametri e cancelletto', async () => {
    const { referrerSenzaCoda } = await import('@/components/GoogleAnalytics');
    expect(referrerSenzaCoda('https://mycity.test/search?q=mario%40gmail.com#x')).toBe('https://mycity.test/search');
    expect(referrerSenzaCoda('')).toBeUndefined();
  });
});

describe('un link copiato dall\'app installata non porta il marcatore (1535)', () => {
  it('source=pwa si toglie, il resto resta', async () => {
    const { indirizzoSenzaSorgentePwa } = await import('@/lib/analytics/posthog');
    expect(indirizzoSenzaSorgentePwa('https://mycity.test/?source=pwa')).toBe('/');
    expect(indirizzoSenzaSorgentePwa('https://mycity.test/store/forno?source=pwa&utm_source=wa#x')).toBe('/store/forno?utm_source=wa#x');
    expect(indirizzoSenzaSorgentePwa('https://mycity.test/store/forno')).toBeNull();
  });
  it('il componente lo toglie dall\'indirizzo dopo averlo letto', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('lib/analytics/posthog.tsx', 'utf8');
    const lettura = src.indexOf("new URLSearchParams(window.location.search).get('source')");
    const pulizia = src.indexOf('window.history.replaceState(window.history.state, \'\', pulito)');
    expect(pulizia).toBeGreaterThan(lettura);
  });
});
