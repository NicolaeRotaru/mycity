/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R23-014 — l'orologio della consegna (un battito al minuto) gira anche sul telefono,
 * dove il riquadro del negozio in evidenza della home non si vede.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: { store: null, products: [], reviews: null }, error: null }) },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function schermoLargo(px: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
    return { matches: px >= min, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T08:30:00Z'));
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: async () => ({ possibile: true }) }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function battitiAlMinuto(): Promise<number> {
  const spia = vi.spyOn(globalThis, 'setInterval');
  const { default: HeroStoreCard } = await import('@/components/home/HeroStoreCard');
  const nodo = document.createElement('div');
  document.body.appendChild(nodo);
  const radice = createRoot(nodo);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { radice.render(createElement(QueryClientProvider, { client }, createElement(HeroStoreCard))); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const n = spia.mock.calls.filter((c) => c[1] === 60_000).length;
  await act(async () => radice.unmount());
  return n;
}

describe('R23-014 — l\'orologio della consegna dove il riquadro non si vede', () => {
  it('su un telefono largo 390 pixel nessun battito al minuto', async () => {
    schermoLargo(390);
    expect(await battitiAlMinuto()).toBe(0);
  });
  it('su un computer largo 1024 pixel l\'orologio batte', async () => {
    schermoLargo(1024);
    expect(await battitiAlMinuto()).toBeGreaterThan(0);
  });
});
