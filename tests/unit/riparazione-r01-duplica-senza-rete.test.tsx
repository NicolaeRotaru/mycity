/**
 * @vitest-environment jsdom
 *
 * «Duplica prodotto» senza rete apriva il modulo vuoto finché la rete non tornava: la lettura
 * del prodotto da duplicare restava in pausa (o cadeva) e la pagina, senza sorgente, mostrava il
 * modulo di un prodotto nuovo. Adesso dice che non riesce a caricare il prodotto da duplicare,
 * con «Riprova», e apre il modulo pieno quando la lettura riesce. React-query vero per le due
 * letture della copia; il modulo è finto e annota con che valori si apre.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  letturaCade: false,
  letture: 0,
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
          single: async () => {
            stato.letture += 1;
            return stato.letturaCade
              ? { data: null, error: { message: 'TypeError: Failed to fetch' } }
              : { data: { id: 'p-pane', seller_id: 's1', name: 'Pane di Altamura', price: 4, images: ['https://x/1.jpg'], attributes: {} }, error: null };
          },
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async () => [],
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
    // Le letture della copia sono quelle vere; le altre (categorie, recesso) arrivano pronte.
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

async function montaPagina() {
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  await act(async () => { root!.render(createElement(QueryClientProvider, { client }, createElement(Pagina))); });
  await gira();
  return div;
}

const testo = () => (div?.textContent ?? '').replace(/\s+/g, ' ');
const modulo = () => (div?.textContent ?? '').includes('MODULO');
const nomeNelModulo = () => (stato.moduli.at(-1)?.initialValues as { name?: string } | undefined)?.name;

beforeEach(() => {
  stato.letturaCade = false;
  stato.letture = 0;
  stato.moduli = [];
  onlineManager.setOnline(true);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  div?.remove();
  root = null;
  onlineManager.setOnline(true);
});

describe('«Duplica prodotto» quando la lettura del prodotto non arriva', () => {
  it('lettura caduta: niente modulo vuoto, si dice e c’è «Riprova»; col «Riprova» riuscito il modulo si apre pieno', async () => {
    stato.letturaCade = true;
    const d = await montaPagina();
    expect(modulo(), 'senza il prodotto da duplicare si apre il modulo vuoto di un prodotto nuovo').toBe(false);
    expect(testo()).toMatch(/Non riesco a caricare il prodotto da duplicare/);

    stato.letturaCade = false;
    const riprova = [...d.querySelectorAll('button')].find((b) => /Riprova/.test(b.textContent ?? ''));
    expect(riprova, 'manca il «Riprova»').toBeTruthy();
    await act(async () => { riprova!.click(); });
    await gira();
    expect(modulo()).toBe(true);
    expect(nomeNelModulo()).toBe('Pane di Altamura (copia)');
  });

  it('senza rete: niente modulo vuoto mentre la lettura aspetta; tornata la rete il modulo si apre pieno', async () => {
    onlineManager.setOnline(false);
    await montaPagina();
    expect(stato.letture, 'controprova: senza rete la lettura resta in pausa').toBe(0);
    expect(modulo(), 'senza rete si apre il modulo vuoto finché la rete non torna').toBe(false);
    expect(testo()).toMatch(/Non riesco a caricare il prodotto da duplicare/);

    await act(async () => { onlineManager.setOnline(true); });
    await gira();
    expect(modulo()).toBe(true);
    expect(nomeNelModulo()).toBe('Pane di Altamura (copia)');
  });
});
