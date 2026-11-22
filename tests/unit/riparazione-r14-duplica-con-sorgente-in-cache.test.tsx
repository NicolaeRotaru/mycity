/**
 * @vitest-environment jsdom
 *
 * «Duplica» con la sorgente e le taglie in memoria da meno di 30 secondi (la memoria del sito) apriva
 * il modulo con quelle di prima: la spunta del recesso e le taglie cambiate nel frattempo non
 * arrivavano. Adesso la copia si apre solo con la sorgente e le taglie riletta all'apertura.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  moduli: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('from=p-pane'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => createElement('p', null, 'CARICAMENTO') }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 's1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: 'p-pane', seller_id: 's1', name: 'Pane di Altamura', price: 4, images: [], attributes: {}, non_recedibile: true },
            error: null,
          }),
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async () => [
    { id: 'v1', label: 'S', options: { Taglia: 'S' } },
    { id: 'v2', label: 'M', options: { Taglia: 'M' } },
  ],
  saveProductVariants: async () => undefined,
}));
vi.mock('@/components/seller/ProductForm', () => ({
  default: (p: Record<string, unknown>) => { stato.moduli.push(p); return createElement('p', null, 'MODULO'); },
}));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...vero,
    useQuery: (o: { queryKey: unknown[] }) => {
      const k = JSON.stringify(o.queryKey);
      if (k.includes('duplicate')) return vero.useQuery(o as never);
      const pronto = { isLoading: false, isError: false, isPending: false, fetchStatus: 'idle', refetch: vi.fn() };
      if (k.includes('categor')) return { ...pronto, data: [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }] };
      return { ...pronto, data: undefined };
    },
  };
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: Pagina } = await import('@/app/seller/products/new/page');

let root: Root | null = null;
let div: HTMLDivElement | null = null;
const gira = async (volte = 6) => {
  for (let i = 0; i < volte; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
};

beforeEach(() => { stato.moduli = []; });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  div?.remove();
  root = null;
});

describe('«Duplica» con la sorgente in memoria da pochi secondi', () => {
  it('il primo modulo aperto ha le taglie e la spunta vere, non quelle della memoria', async () => {
    // Come il sito: 30 secondi di memoria fresca. In memoria: la sorgente di prima, senza spunta e senza taglie.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } });
    client.setQueryData(['duplicate-source', 'p-pane'], { id: 'p-pane', seller_id: 's1', name: 'Pane di Altamura', price: 4, images: [], attributes: {}, non_recedibile: false });
    client.setQueryData(['duplicate-variants', 'p-pane'], []);

    div = document.createElement('div');
    document.body.appendChild(div);
    root = createRoot(div);
    await act(async () => { root!.render(createElement(QueryClientProvider, { client }, createElement(Pagina))); });
    await gira();

    const primo = stato.moduli[0]?.initialValues as { nonRecedibile?: boolean; variants?: unknown[] } | undefined;
    expect(primo, 'il modulo non si è aperto').toBeTruthy();
    expect(primo!.variants, 'il modulo si è aperto con le taglie di prima').toHaveLength(2);
    expect(primo!.nonRecedibile, 'il modulo si è aperto con la spunta di prima').toBe(true);
  });
});
