/**
 * @vitest-environment jsdom
 */
/**
 * R14-013 — La pagina di categoria non tiene un numero vecchio quando la griglia non sa il conto.
 * Griglia finta che espone `onCount`: la pagina vera, react-query vero, database finto.
 * Cura nella pagina: il conto vale solo per i filtri con cui e' stato dato (cambiati i filtri sparisce),
 * e `onCount(null)` («non so») lo toglie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  lettureAlbero: 0,
  griglia: { onCount: null as null | ((n: number | null) => void) },
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
  useTranslations: () => Object.assign((k: string, v?: { count?: number }) => (v && v.count !== undefined ? `${k}:${v.count}` : k), { rich: (k: string) => k }),
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
vi.mock('@/components/ProductGrid', () => ({ default: (p: { onCount?: (n: number | null) => void }) => { mondo.griglia.onCount = p.onCount ?? null; return null; } }));
vi.mock('@/components/SponsoredCarousel', () => ({ default: () => null }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let radice: Root | null = null;
let div: HTMLDivElement | null = null;
let client: QueryClient;

const lascia = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function apri() {
  const { default: CategoryPage } = await import('@/app/category/[slug]/page');
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  const params = { valore: { slug: 'forno' } };
  await act(async () => {
    radice!.render(createElement(QueryClientProvider, { client }, createElement(CategoryPage as ComponentType<Record<string, unknown>>, { params })));
  });
  for (let i = 0; i < 5; i += 1) await lascia();
}

beforeEach(() => {
  mondo.griglia.onCount = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
});
afterEach(() => {
  act(() => radice?.unmount());
  div?.remove();
  client.clear();
  vi.unstubAllGlobals();
});

describe('R14-013 · il conto della categoria non resta vecchio', () => {
  it('con il conto dato lo mostra; con «non so» (null) lo toglie', async () => {
    await apri();
    expect(mondo.griglia.onCount, 'controprova: la griglia deve ricevere onCount').not.toBeNull();
    await act(async () => { mondo.griglia.onCount!(40); });
    expect(div!.textContent).toContain('countLine:40');
    await act(async () => { mondo.griglia.onCount!(null); });
    expect(div!.textContent).not.toContain('countLine:40');
    expect(div!.textContent).not.toContain('countLine');
  });

  it('cambiati i filtri, il numero di prima non resta se la griglia non ridice il conto', async () => {
    await apri();
    await act(async () => { mondo.griglia.onCount!(40); });
    expect(div!.textContent).toContain('countLine:40');
    const promo = Array.from(div!.querySelectorAll('input[type="checkbox"]')).find((x) => /promo/i.test((x.closest('label')?.textContent ?? '') + x.getAttribute('aria-label')));
    expect(promo, 'controprova: serve il filtro promozioni nella pagina').toBeTruthy();
    await act(async () => { (promo as HTMLInputElement).click(); });
    await lascia();
    expect(div!.textContent, 'il numero vecchio e\' rimasto dopo il cambio di filtro').not.toContain('countLine:40');
  });
});
