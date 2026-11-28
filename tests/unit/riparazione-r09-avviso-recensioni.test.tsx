// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R09-002 — La pagina delle recensioni, senza la funzione dei nomi (migrazione 181), scriveva l'avviso a
 * ogni apertura. Adesso una volta per processo; le recensioni sono firmate col nome di consegna degli
 * ordini (R11-001: prima restavano «Cliente» anche per chi aveva ordinato).
 */
const stato = vi.hoisted(() => ({ code: 'PGRST202', rpc: 0 }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) },
    rpc: async () => { stato.rpc += 1; return { data: null, error: { code: stato.code, message: 'errore nomi' } }; },
    // Senza la 181 il nome arriva dagli ordini che il negozio legge già (il nome di consegna).
    from: (tabella: string) => tabella === 'orders' ? ({
      select: () => ({
        in: () => ({
          order: () => ({ limit: async () => ({ data: [{ user_id: 'u1', delivery_full_name: 'Maria Rossi' }], error: null }) }),
        }),
      }),
    }) : ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [{ id: 'rev-1', user_id: 'u1', rating: 5, comment: 'Buonissimo', created_at: '2026-11-10T10:00:00Z', order_id: 'ordine-123456', seller_reply: null, seller_reply_at: null }],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function apri() {
  const { default: Pagina } = await import('@/app/seller/reviews/page');
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))));
  for (let i = 0; i < 6; i++) await pausa();
  const testo = c.textContent ?? '';
  await act(async () => root.unmount());
  c.remove();
  return testo;
}
const avvisi = async () => {
  const { logger } = await import('@/lib/logger');
  return vi.mocked(logger.warn).mock.calls.filter((x) => /nomi dei clienti/.test(String(x[0]))).length;
};

beforeEach(async () => {
  vi.resetModules();
  const { logger } = await import('@/lib/logger');
  vi.mocked(logger.warn).mockClear();
});

describe('R09-002 · recensioni: l\'avviso della funzione assente non si ripete', () => {
  it('due aperture senza la 181: un avviso, recensioni leggibili e firmate col nome di consegna', async () => {
    stato.code = 'PGRST202';
    stato.rpc = 0;
    const prima = await apri();
    expect(prima).toContain('Buonissimo');
    expect(prima, 'senza la 181 le recensioni non usano il ripiego dei nomi').toContain('Maria Rossi');
    expect(await apri()).toContain('Buonissimo');
    expect(await avvisi()).toBe(1);
    expect(stato.rpc, 'una sola chiamata alla funzione per apertura').toBe(2);
  });

  it('un guasto vero: un avviso a ogni apertura', async () => {
    stato.code = '57014';
    await apri();
    await apri();
    expect(await avvisi()).toBe(2);
  });
});
