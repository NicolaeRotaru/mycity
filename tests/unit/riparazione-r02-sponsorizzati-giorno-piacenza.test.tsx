// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Il carosello degli annunci sponsorizzati chiedeva gli annunci attivi «oggi»
 * col giorno di Greenwich (`new Date().toISOString().slice(0, 10)`). Fra
 * mezzanotte e l'una di Piacenza (le due d'estate) valeva ancora il giorno
 * prima: un annuncio pagato che parte oggi restava nascosto, e uno scaduto ieri
 * restava in vetrina gratis. Qui si guarda quale giorno arriva davvero al
 * filtro della vista (`start_date <= oggi`, `end_date >= oggi`).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const filtri = vi.hoisted(() => [] as Array<{ tabella: string; metodo: string; colonna: unknown; valore: unknown }>);

vi.mock('@/lib/supabase/client', () => {
  const tabella = (nome: string) => {
    const catena: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, metodo: string) {
          if (metodo === 'then') {
            return (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(ok, ko);
          }
          return (colonna?: unknown, valore?: unknown) => {
            filtri.push({ tabella: nome, metodo, colonna, valore });
            return catena;
          };
        },
      },
    );
    return catena;
  };
  return { supabase: { from: tabella } };
});

let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
  filtri.length = 0;
});

async function monta() {
  const { default: SponsoredCarousel } = await import('@/components/SponsoredCarousel');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client }, createElement(SponsoredCarousel, { placement: 'home_top' })));
  });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  chiudi = () => {
    act(() => root?.unmount());
    host.remove();
    client.clear();
  };
}

function giornoChiesto(colonna: string, metodo: 'lte' | 'gte') {
  return filtri.find((f) => f.tabella === 'sponsored_active_public' && f.metodo === metodo && f.colonna === colonna)?.valore;
}

describe('gli annunci sponsorizzati si accendono e si spengono sul giorno di Piacenza', () => {
  it('alle 00:30 del 6 novembre a Piacenza (23:30 del 5 a Greenwich) «oggi» è il 6', async () => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T23:30:00Z'));
    await monta();
    expect(giornoChiesto('start_date', 'lte'), 'l’annuncio che parte oggi resta nascosto').toBe('2026-11-06');
    expect(giornoChiesto('end_date', 'gte'), 'l’annuncio scaduto ieri resta in vetrina').toBe('2026-11-06');
  });

  it('d’estate, all’01:30 del 4 agosto a Piacenza (23:30 del 3 a Greenwich) «oggi» è il 4', async () => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-03T23:30:00Z'));
    await monta();
    expect(giornoChiesto('start_date', 'lte')).toBe('2026-08-04');
    expect(giornoChiesto('end_date', 'gte')).toBe('2026-08-04');
  });
});
