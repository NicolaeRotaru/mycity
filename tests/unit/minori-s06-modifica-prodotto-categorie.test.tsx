import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { queryKeys } from '@/lib/queries/keys';

/**
 * S06 · 1606 — Se la lettura delle categorie cade, «Modifica prodotto» lo dice
 * con «Riprova» invece di aprire il modulo col prodotto «senza categoria».
 */
const stato = vi.hoisted(() => ({ categorieInErrore: true }));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), use: (p: { valore: unknown }) => p.valore }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/seller/ProductForm', () => ({ default: () => <p>MODULO</p> }));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: (o: { queryKey: unknown[] }) => {
    const k = JSON.stringify(o.queryKey);
    if (k === JSON.stringify(queryKeys.categories.form)) {
      return stato.categorieInErrore
        ? { data: undefined, isError: true, isLoading: false, refetch: vi.fn() }
        : { data: [{ id: 'c1', name: 'Pane', slug: 'pane', parent_id: null }], isError: false, isLoading: false, refetch: vi.fn() };
    }
    if (k.includes('variants')) return { data: [], error: null, isLoading: false, isFetching: false, isFetchedAfterMount: true };
    return {
      data: { id: 'p1', name: 'Focaccia', status: 'available', category_id: 'c1', attributes: {} },
      isLoading: false, error: null, isFetching: false, isFetchedAfterMount: true,
    };
  },
}));

const { default: Pagina } = await import('@/app/seller/products/[id]/edit/page');
const disegna = () => renderToStaticMarkup(<Pagina params={{ valore: { id: 'p1' } } as unknown as Promise<{ id: string }>} />);

describe('1606 — categorie non lette', () => {
  it('niente modulo, ma «Non riesco a leggere le categorie» con «Riprova»', () => {
    stato.categorieInErrore = true;
    const html = disegna();
    expect(html).not.toContain('MODULO');
    expect(html).toContain('Non riesco a leggere le categorie');
    expect(html).toContain('Riprova');
  });
  it('con le categorie lette il modulo si apre', () => {
    stato.categorieInErrore = false;
    expect(disegna()).toContain('MODULO');
  });
});
