/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R08-017 — sul telefono la home montava il riquadro del negozio in evidenza
 * (nascosto sotto i 768 pixel con `hidden md:flex`) e chiedeva lo stesso al
 * database `vetrina_home` e, dietro, la veloce alla cassa.
 *
 * Il negozio è aperto tutto il giorno: alle 9:30 la veloce si chiede, quindi sul
 * computer partono tutte e due le domande; sul telefono nessuna.
 */
const mondo = vi.hoisted(() => {
  const tutto = [['00:00', '23:59']];
  return {
    rpc: 0,
    NEGOZIO: {
      id: 'pane-quotidiano', store_name: 'Pane Quotidiano', store_address: 'Via Roma 1, Piacenza',
      store_logo: null, store_media: [],
      store_hours: { mon: tutto, tue: tutto, wed: tutto, thu: tutto, fri: tutto, sat: tutto, sun: tutto },
    },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: async () => {
      mondo.rpc += 1;
      return { data: { store: mondo.NEGOZIO, products: [], reviews: null }, error: null };
    },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let chiamateCassa: string[] = [];
function schermoLargo(px: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
    return { matches: px >= min, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} };
  });
}

beforeEach(() => {
  mondo.rpc = 0;
  chiamateCassa = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T08:30:00Z')); // giovedì, 9:30 a Piacenza
  vi.stubGlobal('fetch', (url: unknown) => {
    chiamateCassa.push(String(url));
    return Promise.resolve({ ok: true, json: async () => ({ possibile: true }) });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function monta() {
  const { default: HeroStoreCard } = await import('@/components/home/HeroStoreCard');
  const nodo = document.createElement('div');
  document.body.appendChild(nodo);
  const radice = createRoot(nodo);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { radice.render(createElement(QueryClientProvider, { client }, createElement(HeroStoreCard))); });
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  await act(async () => radice.unmount());
}

describe('R08-017 — il riquadro nascosto non va in rete', () => {
  it('su un telefono largo 390 pixel nessuna domanda al database né alla cassa', async () => {
    schermoLargo(390);
    await monta();
    expect(mondo.rpc).toBe(0);
    expect(chiamateCassa.filter((u) => u.includes('/api/consegna/veloce'))).toEqual([]);
  });

  it('su un computer largo 1024 pixel il riquadro chiede il negozio come prima', async () => {
    schermoLargo(1024);
    await monta();
    expect(mondo.rpc).toBe(1);
  });
});
