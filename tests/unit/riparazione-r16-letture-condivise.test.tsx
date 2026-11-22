/**
 * @vitest-environment jsdom
 */
/**
 * R16-009 — L'ALBERO DELLE CATEGORIE SI LEGGE UNA VOLTA PER PAGINA, NON DUE O TRE.
 *
 * Menu (CategoryBar), piede (Footer), ricerca e pagina di categoria leggevano la stessa tabella con
 * tre chiavi diverse: aprendo la ricerca o una categoria le stesse righe si chiedevano al database
 * due volte, e il precarico del sito (che riempie solo la chiave del menu) non serviva a quelle
 * pagine. Qui gira il react-query vero, tutti nello stesso QueryClient come nel sito, e un database
 * finto conta le letture dell'albero (quelle che chiedono anche `slug`: la lettura delle categorie
 * piene chiede solo `id, parent_id` e non conta).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  lettureAlbero: 0,
  categorie: [
    { id: 'c-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null, icon: null },
    { id: 'c-forno', slug: 'forno', name: 'Forno', parent_id: 'c-ali', icon: null },
    { id: 'c-ele', slug: 'elettronica', name: 'Elettronica', parent_id: null, icon: null },
  ],
}));

vi.mock('react', async (originale) => {
  const vero = await originale<typeof import('react')>();
  // La pagina di categoria legge i parametri con `use()` (React 19 di Next): qui, col React 18 delle
  // prove, basta restituire il valore già pronto che la prova le passa.
  const use = (p: { valore?: unknown }) => p.valore;
  return { ...vero, default: { ...vero, use }, use };
});

vi.mock('@/lib/supabase/client', () => {
  const da = (tabella: string) => {
    const q: Record<string, unknown> = {};
    let colonne = '';
    for (const m of ['eq', 'order', 'limit', 'gt', 'gte', 'lte', 'is', 'in', 'range', 'not', 'or', 'maybeSingle']) q[m] = () => q;
    q.select = (c: string) => { colonne = c ?? ''; return q; };
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let r: { data: unknown; error: unknown; count?: number };
      if (tabella === 'categories') {
        if (colonne.includes('slug')) mondo.lettureAlbero += 1;
        r = { data: mondo.categorie, error: null };
      } else if (tabella === 'products') {
        r = { data: [{ id: 'p1', category_id: 'c-forno', seller_id: 's1' }], error: null, count: 1 };
      } else if (tabella === 'seller_public_profiles') {
        r = { data: [{ id: 's1' }], error: null };
      } else {
        r = { data: [], error: null };
      }
      return Promise.resolve(r).then(ok, ko);
    };
    return q;
  };
  return { supabase: { from: da, rpc: () => Promise.resolve({ data: [], error: null }) } };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...resto }: { href: string; children?: ReactNode }) => ce('a', { href: String(href), ...resto }, children) };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('q=pane'),
  notFound: () => { throw new Error('notFound'); },
}));
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { rich: (k: string) => k }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('@/lib/analytics/events', () => ({ trackCategoryViewed: () => {}, trackSearchPerformed: () => {} }));
vi.mock('@/lib/queries/griglia-prodotti', () => ({ contaProdottiDellaGriglia: async () => 1 }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));
vi.mock('@/components/ProductGrid', () => ({ default: () => null }));
vi.mock('@/components/SponsoredCarousel', () => ({ default: () => null }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let radice: Root | null = null;
let div: HTMLDivElement | null = null;
let client: QueryClient;

async function disegnaInsieme(componenti: Array<[ComponentType<never>, Record<string, unknown>?]>) {
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => {
    radice!.render(
      createElement(
        QueryClientProvider,
        { client },
        ...componenti.map(([C, p], i) => createElement(C as ComponentType<Record<string, unknown>>, { key: i, ...(p ?? {}) })),
      ),
    );
  });
  for (let i = 0; i < 50 && client.isFetching() > 0; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

beforeEach(() => {
  mondo.lettureAlbero = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
});

afterEach(() => {
  act(() => radice?.unmount());
  div?.remove();
  client.clear();
  vi.unstubAllGlobals();
});

describe('R16-009 — menu, piede e pagine condividono la lettura dell\'albero delle categorie', () => {
  it('menu + piede + ricerca: una lettura sola', async () => {
    const { default: CategoryBar } = await import('@/components/CategoryBar');
    const { default: Footer } = await import('@/components/Footer');
    const { default: SearchPage } = await import('@/app/search/page');
    await disegnaInsieme([[CategoryBar as ComponentType<never>], [SearchPage as ComponentType<never>], [Footer as ComponentType<never>]]);
    expect(div!.querySelector('a[href="/category/alimentari"]'), 'controprova: il piede elenca le categorie lette').not.toBeNull();
    expect(mondo.lettureAlbero, 'la ricerca rilegge le categorie con un\'altra chiave: due letture uguali').toBe(1);
  });

  it('menu + piede + pagina di categoria: una lettura sola, e la pagina trova la sua categoria e le figlie', async () => {
    const { default: CategoryBar } = await import('@/components/CategoryBar');
    const { default: Footer } = await import('@/components/Footer');
    const { default: CategoryPage } = await import('@/app/category/[slug]/page');
    const params = { valore: { slug: 'alimentari' } };
    await disegnaInsieme([[CategoryBar as ComponentType<never>], [CategoryPage as ComponentType<never>, { params }], [Footer as ComponentType<never>]]);
    expect(div!.querySelector('h1')?.textContent ?? '', 'controprova: la pagina mostra la categoria').toContain('Alimentari');
    expect(div!.querySelector('a[href="/category/forno"]'), 'controprova: la sottocategoria piena c\'è').not.toBeNull();
    expect(mondo.lettureAlbero, 'la pagina di categoria rilegge le categorie con un\'altra chiave: due letture uguali').toBe(1);
  });

  it('col precarico del sito già in memoria (stessa chiave), la ricerca e la categoria non tornano al database', async () => {
    client.setQueryData(['categories', 'tree'], mondo.categorie);
    const { default: SearchPage } = await import('@/app/search/page');
    const { default: CategoryPage } = await import('@/app/category/[slug]/page');
    await disegnaInsieme([[SearchPage as ComponentType<never>], [CategoryPage as ComponentType<never>, { params: { valore: { slug: 'alimentari' } } }]]);
    const titoli = [...div!.querySelectorAll('h1')].map((h) => h.textContent ?? '');
    expect(titoli.some((t) => t.includes('Alimentari')), 'controprova: la pagina mostra la categoria').toBe(true);
    expect(mondo.lettureAlbero, 'con l\'albero già precaricato una pagina lo ha riletto').toBe(0);
  });
});
