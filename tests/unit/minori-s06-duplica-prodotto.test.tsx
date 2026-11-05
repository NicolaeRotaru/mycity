import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * S06 — «Duplica» un prodotto (/seller/products/new?from=ID).
 * 2578: la copia di un prodotto escluso dal recesso nasce esclusa.
 * 172:  senza le taglie lette la copia non si apre; e se le taglie non si
 *       salvano dopo l'inserimento si va alla modifica, non si reinserisce.
 */
const stato = vi.hoisted(() => ({
  varianti: { data: [] as unknown[], isLoading: false, isError: false } as Record<string, unknown>,
  moduli: [] as Record<string, unknown>[],
  mutazione: null as null | { mutationFn: (a: unknown) => Promise<unknown>; onError: (e: unknown) => void },
  push: vi.fn(),
  inserito: { id: 'nuovo-1' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: stato.push }),
  useSearchParams: () => new URLSearchParams('from=p1'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => <p>CARICAMENTO</p> }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 's1' } } }) },
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: stato.inserito, error: null }) }) }) }),
  },
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: vi.fn(),
  saveProductVariants: async () => { throw new Error('rete'); },
}));
vi.mock('@/components/seller/ProductForm', () => ({
  default: (p: Record<string, unknown>) => { stato.moduli.push(p); return <p>MODULO</p>; },
}));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: (o: typeof stato.mutazione) => { stato.mutazione = o; return { mutate: vi.fn(), isPending: false }; },
  useQuery: (o: { queryKey: unknown[] }) => {
    const k = JSON.stringify(o.queryKey);
    if (k.includes('duplicate-source')) {
      return { data: { name: 'Pane', seller_id: 's1', non_recedibile: true, attributes: {} }, isLoading: false };
    }
    if (k.includes('duplicate-variants')) return { refetch: vi.fn(), ...stato.varianti };
    return { data: undefined, isLoading: false };
  },
}));

const { default: Pagina } = await import('@/app/seller/products/new/page');

beforeEach(() => { stato.moduli = []; stato.push.mockClear(); stato.varianti = { data: [], isLoading: false, isError: false }; });

describe('2578 — escluso dal recesso', () => {
  it('la copia parte con la spunta', () => {
    renderToStaticMarkup(<Pagina />);
    const iniziali = stato.moduli.at(-1)?.initialValues as Record<string, unknown>;
    expect(iniziali.nonRecedibile).toBe(true);
  });
});

describe('172 — le taglie del duplicato', () => {
  it('se la lettura delle taglie cade, il modulo non si apre e c\'è «Riprova»', () => {
    stato.varianti = { data: undefined, isLoading: false, isError: true };
    const html = renderToStaticMarkup(<Pagina />);
    expect(html).not.toContain('MODULO');
    expect(html).toContain('Riprova');
  });
  it('mentre si leggono le taglie il modulo aspetta', () => {
    stato.varianti = { data: undefined, isLoading: true, isError: false };
    expect(renderToStaticMarkup(<Pagina />)).not.toContain('MODULO');
  });
  it('taglie non salvate dopo l\'inserimento: si va alla modifica del prodotto creato', async () => {
    renderToStaticMarkup(<Pagina />);
    const m = stato.mutazione!;
    let errore: unknown;
    try { await m.mutationFn({ payload: { status: 'draft' }, variants: [{ label: 'S', options: {}, stock: 1 }] }); } catch (e) { errore = e; }
    m.onError(errore);
    expect(stato.push).toHaveBeenCalledWith('/seller/products/nuovo-1/edit');
  });
});
