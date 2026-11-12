// @vitest-environment jsdom
/**
 * R07-015 (12/11/2026) — se la recensione al negozio entrava e quella al fattorino
 * no (rete caduta fra le due scritture), la pagina guardava solo il negozio, diceva
 * «Hai già lasciato una recensione» e il fattorino non si poteva più recensire.
 */
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
  recensioni: {} as Record<string, unknown[]>,
  inserite: [] as string[],
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
  conFattorinoDellOrdine: async (_s: unknown, r: unknown[]) => r.map((x) => ({ ...(x as object), rider: { full_name: 'Marco' } })),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }) },
    from: (t: string) =>
      t === 'orders'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => stato.ordine }) }) }
        : {
            select: () => ({ eq: () => ({ limit: async () => ({ data: stato.recensioni[t] ?? [], error: null }) }) }),
            insert: async () => { stato.inserite.push(t); return { error: stato.erroreInsert }; },
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
  stato.ordine = { data: { id: 'o1', delivery_status: 'DELIVERED', seller_id: 's1', rider_id: 'r1' }, error: null };
  stato.recensioni = {};
  stato.inserite = [];
  stato.erroreInsert = null;
  stato.toast = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
});

describe('R07-015 · negozio recensito, fattorino no: il fattorino si può ancora votare', () => {
  it('la pagina chiede solo il voto al fattorino, e scrive solo quello', async () => {
    stato.recensioni = { store_reviews: [{ id: 'sr1' }] };
    await monta();
    expect(c.textContent).not.toContain('Hai già lasciato una recensione');
    expect(c.textContent).toContain('Marco');
    expect(c.textContent).not.toContain('Pane Quotidiano');
    expect(invia().disabled).toBe(true);
    const stelle = c.querySelectorAll('[role=group][aria-label="Il tuo voto sul fattorino"] button');
    expect(stelle.length).toBeGreaterThan(0);
    await act(async () => { (stelle[stelle.length - 1] as HTMLElement).click(); });
    expect(invia().disabled).toBe(false);
    await act(async () => { invia().click(); });
    for (let i = 0; i < 5; i++) await pausa();
    expect(stato.inserite).toEqual(['rider_reviews']);
  });

  it('tutti e due recensiti: «già recensito»', async () => {
    stato.recensioni = { store_reviews: [{ id: 'sr1' }], rider_reviews: [{ id: 'rr1' }] };
    await monta();
    expect(c.textContent).toContain('Hai già lasciato una recensione');
  });

  it('nessuno recensito: si chiedono tutti e due', async () => {
    await monta();
    expect(c.textContent).toContain('Pane Quotidiano');
    expect(c.textContent).toContain('Marco');
  });
});
