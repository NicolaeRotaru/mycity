// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Sessione S02 (5/11/2026) — la pagina «Lascia una recensione».
 *  · 1735: una lettura caduta dice «Non riesco a caricare» (con Riprova), non «Ordine non trovato»;
 *  · 575:  le stelle partono vuote e «Invia» è spento finché non si vota; una recensione già
 *          lasciata si dice al posto del modulo, e il doppione non si spaccia per «Grazie».
 */
const stato = vi.hoisted(() => ({
  ordine: { data: null as unknown, error: null as unknown },
  recensioni: [] as unknown[],
  erroreInsert: null as unknown,
  toast: [] as string[],
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('react', async (o) => ({ ...(await o<Record<string, unknown>>()), use: () => ({ id: 'o1' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => stato.toast.push(`ok:${m}`), info: (m: string) => stato.toast.push(`info:${m}`), error: (m: string) => stato.toast.push(`err:${m}`) },
}));
vi.mock('@/lib/queries/negozio-dell-ordine', () => ({
  conNegozioDellOrdine: async (_s: unknown, r: unknown[]) => r.map((x) => ({ ...(x as object), seller: { store_name: 'Pane Quotidiano' } })),
  conFattorinoDellOrdine: async (_s: unknown, r: unknown[]) => r.map((x) => ({ ...(x as object), rider: null })),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }) },
    from: (t: string) =>
      t === 'orders'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => stato.ordine }) }) }
        : {
            select: () => ({ eq: () => ({ limit: async () => ({ data: stato.recensioni, error: null }) }) }),
            insert: async () => ({ error: stato.erroreInsert }),
          },
  },
}));

import OrderReviewPage from '@/app/orders/[id]/review/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(OrderReviewPage, { params: Promise.resolve({ id: 'o1' }) }))),
  );
  for (let i = 0; i < 5; i++) await pausa();
}
const invia = () => Array.from(c.querySelectorAll('button')).find((b) => /Invia recensione/.test(b.textContent ?? '')) as HTMLButtonElement;

beforeEach(() => {
  stato.ordine = { data: { id: 'o1', delivery_status: 'DELIVERED', seller_id: 's1', rider_id: null }, error: null };
  stato.recensioni = [];
  stato.erroreInsert = null;
  stato.toast = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
});

describe('la pagina della recensione', () => {
  it('1735 · lettura caduta: «Non riesco a caricare», non «Ordine non trovato»', async () => {
    stato.ordine = { data: null, error: { code: '08006', message: 'fetch failed' } };
    await monta();
    expect(c.textContent).toContain('Non riesco a caricare');
    expect(c.textContent).not.toContain('Ordine non trovato');
  });

  it('575 · nessuna stella scelta all apertura e «Invia» spento finché non si vota', async () => {
    await monta();
    expect(c.querySelectorAll('button[aria-pressed="true"]').length).toBe(0);
    expect(invia().disabled).toBe(true);
    await act(async () => { (c.querySelector('button[aria-label="4 stelle"]') as HTMLButtonElement).click(); });
    expect(invia().disabled).toBe(false);
  });

  it('575 · recensione già lasciata: la pagina lo dice al posto del modulo', async () => {
    stato.recensioni = [{ id: 'r1' }];
    await monta();
    expect(c.textContent).toContain('Hai già lasciato una recensione');
    expect(invia()).toBeUndefined();
  });

  it('575 · il doppione rifiutato dal database non si spaccia per «Grazie»', async () => {
    stato.erroreInsert = { code: '23505', message: 'duplicate key' };
    await monta();
    await act(async () => { (c.querySelector('button[aria-label="2 stelle"]') as HTMLButtonElement).click(); });
    await act(async () => { invia().click(); });
    for (let i = 0; i < 3; i++) await pausa();
    expect(stato.toast.join(' ')).toContain('Avevi già recensito');
    expect(stato.toast.join(' ')).not.toContain('Grazie per la recensione');
  });
});
