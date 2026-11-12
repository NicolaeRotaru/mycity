import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R08-003 e R08-014 — le pagine in più della vetrina (app/store/[id]/[slug]).
 *
 * R08-003: la pagina ha un solo h1, col suo titolo; «Pagina non trovata» è l'h1.
 * R08-014: una pagina «nascosta» si apre a chi ha il link (come promette la
 *   casella dell'editor) e il banner dell'anteprima lo vede solo il proprietario.
 *   Che il suo contenuto fosse già pubblico lo prova
 *   tests/sql/rls/riparazione-r08-la-pagina-nascosta-e-gia-nei-dati-pubblici.test.sql.
 */

const stato = vi.hoisted(() => ({
  preview: false,
  viewerId: null as string | null,
  data: null as Record<string, unknown> | null,
}));

// Le prove girano su React 18, che `use()` non l'ha: lo si finge come nelle altre prove delle pagine.
vi.mock('react', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  use: (p: { value: unknown }) => p.value,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'preview' && stato.preview ? '1' : null) }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: stato.viewerId }) }));
vi.mock('@/components/store-sections/useStorePageData', () => ({ useStorePageData: () => stato.data }));
vi.mock('@/components/store-sections/SectionRenderer', () => ({
  default: ({ sections }: { sections: Array<{ id: string }> }) => (
    <div>{sections.map((s) => <h2 key={s.id}>La nostra storia</h2>)}</div>
  ),
}));
vi.mock('@/components/store-sections/StoreNav', () => ({ default: () => <nav>menu</nav> }));
vi.mock('@/components/store-sections/ScheletroNegozio', () => ({ default: () => <div>scheletro</div> }));

const { default: Pagina } = await import('@/app/store/[id]/[slug]/page');

const NEGOZIO = 'negozio-a';
const sito = {
  theme: 'classico',
  menu: { enabled: false, links: [] },
  pages: [
    { id: 'home', slug: '', title: 'Home', visibility: 'public', seo: {}, sections: [] },
    { id: 'p1', slug: 'chi-siamo', title: 'Chi siamo', visibility: 'public', seo: {},
      sections: [{ id: 's1', type: 'richText', enabled: true, config: {} }] },
    { id: 'p2', slug: 'ordini-per-le-feste', title: 'Ordini per le feste', visibility: 'hidden', seo: {},
      sections: [{ id: 's2', type: 'richText', enabled: true, config: {} }] },
  ],
};

function pronta<T>(v: T): Promise<T> {
  // `use()` di React legge subito una promessa già marcata come compiuta.
  return Object.assign(Promise.resolve(v), { status: 'fulfilled', value: v });
}

function disegna(slug: string): string {
  return renderToStaticMarkup(<Pagina params={pronta({ id: NEGOZIO, slug })} />);
}

const h1 = (html: string) => Array.from(html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)).map((m) => m[1]);

beforeEach(() => {
  stato.preview = false;
  stato.viewerId = null;
  stato.data = {
    isLoading: false, isError: false, approved: true,
    store: { id: NEGOZIO, store_name: 'Forno Vetrina' },
    custom: {}, accent: '#C0492C', site: sito, ctx: { storeId: NEGOZIO },
    refetch: vi.fn(),
  };
});

describe('R08-003 — la pagina in più ha il suo titolo principale', () => {
  it('«Chi siamo» ha un solo h1, «Chi siamo»', () => {
    expect(h1(disegna('chi-siamo'))).toEqual(['Chi siamo']);
  });

  it('una pagina che non esiste dice «Pagina non trovata» come h1, non come h3', () => {
    const html = disegna('non-esiste');
    expect(h1(html)).toEqual(['Pagina non trovata']);
    expect(html).not.toMatch(/<h3[^>]*>Pagina non trovata/);
  });
});
