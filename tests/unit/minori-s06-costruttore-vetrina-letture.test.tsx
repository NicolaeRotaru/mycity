import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * S06 — Il costruttore della vetrina.
 * 308: una lettura caduta dice «Non riesco a leggere … Riprova», non un elenco vuoto
 *      o un caricamento infinito (categorie, prodotti in evidenza, banner, vetrina intera).
 * 343: il pulsante del banner non si può puntare a un prodotto che il cliente non vede.
 */
const stato = vi.hoisted(() => ({ lettura: {} as Record<string, unknown> }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }), usePathname: () => '/seller/site', useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: () => stato.lettura,
}));
const errore = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };

const { default: CategorySelect } = await import('@/components/seller/site/CategorySelect');
const { default: FeaturedProductsPicker } = await import('@/components/seller/FeaturedProductsPicker');
const { default: BannerFields } = await import('@/components/seller/site/BannerFields');
const { default: SiteEditor } = await import('@/components/seller/site/SiteEditor');

const banner = (productId = '') => ({
  id: 'b1', type: 'banner', config: { title: 'Pane', cta: { label: 'Scopri', target: { kind: 'product', productId } } },
}) as never;

beforeEach(() => { stato.lettura = errore; });

describe('308 — letture cadute', () => {
  it('categorie', () => {
    expect(renderToStaticMarkup(<CategorySelect valueKind="slug" value="" onChange={() => {}} />)).toContain('Non riesco a leggere le categorie');
  });
  it('prodotti in evidenza: non «Pubblica dei prodotti»', () => {
    const html = renderToStaticMarkup(<FeaturedProductsPicker value={[]} onChange={() => {}} />);
    expect(html).not.toContain('Pubblica dei prodotti');
    expect(html).toContain('Riprova');
  });
  it('prodotto del banner', () => {
    expect(renderToStaticMarkup(<BannerFields section={banner()} onChange={() => {}} />)).toContain('Non riesco a leggere i tuoi prodotti');
  });
  it('la vetrina intera: niente scheletro infinito', () => {
    expect(renderToStaticMarkup(<SiteEditor />)).toContain('Non riesco a leggere la tua vetrina');
  });
});

describe('343 — banner verso un prodotto in bozza', () => {
  it('la bozza si vede marcata e non si sceglie', () => {
    stato.lettura = {
      data: [{ id: 'p1', name: 'Pane', status: 'available' }, { id: 'p2', name: 'Torta', status: 'draft' }],
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    const html = renderToStaticMarkup(<BannerFields section={banner()} onChange={() => {}} />);
    expect(html).toMatch(/<option value="p2" disabled="">Torta \(non visibile ai clienti\)<\/option>/);
    expect(html).toMatch(/<option value="p1">Pane<\/option>/);
  });
});
