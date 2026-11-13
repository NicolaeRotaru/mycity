/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R23-013 (13/11/2026) — LA VELOCITÀ VISTA DAI CLIENTI VERI: LA PRIMA VISITA ANDAVA PERSA.
 *
 * Le misure di velocità (web-vitals) si accendevano al montaggio e partivano con `track()`, che
 * senza consenso statistico le butta. Alla prima visita il consenso arriva dopo: FCP e TTFB
 * arrivano subito, LCP si chiude al primo clic (spesso proprio quello sul banner). Finivano
 * nel vuoto, e web-vitals non le ridà. Adesso le misure si accendono quando c'è il consenso, e
 * leggono le voci che il browser ha già registrato.
 *
 * La libreria finta delle misure fa come quella vera con le voci già registrate: appena
 * l'ascoltatore si accende, consegna la misura.
 */

const stato = vi.hoisted(() => ({
  consenso: null as null | { analytics: boolean; marketing: boolean },
  accese: [] as string[],
}));

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  POSTHOG_ACCESO: true,
}));
vi.mock('@/lib/consent', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  readConsent: () => stato.consenso,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
}));
vi.mock('web-vitals', () => {
  const misura = (nome: string, valore: number) => (consegna: (m: { value: number; rating: string }) => void) => {
    stato.accese.push(nome);
    consegna({ value: valore, rating: 'good' });
  };
  return {
    onFCP: misura('FCP', 900),
    onTTFB: misura('TTFB', 120),
    onLCP: misura('LCP', 1800),
    onCLS: misura('CLS', 0.01),
    onINP: misura('INP', 80),
  };
});

/** Le misure di velocità arrivate a PostHog, per nome. */
function misureSpedite(): string[] {
  return posthog.capture.mock.calls
    .filter((c) => c[0] === 'web_vital')
    .map((c) => String((c[1] as { metric: string }).metric))
    .sort();
}

async function monta() {
  vi.resetModules();
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { default: PostHogProvider } = await import('@/lib/analytics/posthog');
  const radice = createRoot(document.createElement('div'));
  await act(async () => { radice.render(createElement(PostHogProvider)); });
  return { radice, act };
}

async function lasciaCorrere() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
  stato.consenso = null;
  stato.accese = [];
  for (const f of Object.values(posthog)) f.mockClear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('la prima visita: il consenso arriva dopo le misure', () => {
  it('prima del consenso non si misura e non parte niente', async () => {
    const { radice, act } = await monta();
    await lasciaCorrere();

    expect(stato.accese, 'le misure si accendono prima del consenso e finiscono nel vuoto').toEqual([]);
    expect(misureSpedite()).toEqual([]);
    await act(async () => radice.unmount());
  });

  it('al consenso arrivano anche FCP, TTFB e LCP della pagina d ingresso', async () => {
    const { radice, act } = await monta();
    await lasciaCorrere();

    stato.consenso = { analytics: true, marketing: false };
    window.dispatchEvent(new CustomEvent('mc:consent-change', { detail: stato.consenso }));
    await vi.waitFor(() => expect(misureSpedite().length).toBe(5));

    expect(misureSpedite(), 'la visita a cache vuota non la misura nessuno').toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
    await act(async () => radice.unmount());
  });

  it('un secondo cambio di consenso non accende le misure due volte', async () => {
    const { radice, act } = await monta();
    stato.consenso = { analytics: true, marketing: false };
    window.dispatchEvent(new CustomEvent('mc:consent-change', { detail: stato.consenso }));
    window.dispatchEvent(new CustomEvent('mc:consent-change', { detail: stato.consenso }));
    await vi.waitFor(() => expect(misureSpedite().length).toBe(5));
    await lasciaCorrere();

    expect(stato.accese.filter((n) => n === 'FCP')).toEqual(['FCP']);
    expect(misureSpedite().length).toBe(5);
    await act(async () => radice.unmount());
  });

  it('chi rifiuta resta senza misure', async () => {
    const { radice, act } = await monta();
    stato.consenso = { analytics: false, marketing: false };
    window.dispatchEvent(new CustomEvent('mc:consent-change', { detail: stato.consenso }));
    await lasciaCorrere();

    expect(stato.accese).toEqual([]);
    expect(misureSpedite()).toEqual([]);
    await act(async () => radice.unmount());
  });
});

describe('chi torna col consenso già dato', () => {
  it('le misure partono subito, una per tipo', async () => {
    stato.consenso = { analytics: true, marketing: false };
    const { radice, act } = await monta();
    await vi.waitFor(() => expect(misureSpedite().length).toBe(5));

    expect(misureSpedite()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
    await act(async () => radice.unmount());
  });
});
