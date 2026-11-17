// @vitest-environment jsdom
/**
 * R02-006 — Nell'amministrazione, «Nuovo prodotto» passava al modulo `create.mutate(…)`: la
 * funzione torna subito, quindi la guardia del modulo contro il doppio invio si riapriva appena
 * partito l'inserimento, e un secondo invio ravvicinato creava un secondo prodotto uguale.
 * Ora la pagina restituisce la promessa dell'inserimento (come la pagina del negozio): la guardia
 * resta chiusa fino in fondo.
 *
 * Qui la pagina VERA dell'amministrazione col modulo VERO (gli si danno solo i valori già pronti),
 * React Query vero, e la rotta finta che risponde quando lo dice la prova.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({ spinte: [] as string[] }));

vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    error: () => undefined, success: () => undefined, warning: () => undefined,
    info: () => undefined, loading: () => undefined, dismiss: () => undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (u: string) => { mondo.spinte.push(u); }, replace: () => undefined }),
  usePathname: () => '/admin/products/new',
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/components/products/ImportFromUrlBox', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      getUser: async () => ({ data: { user: { id: 'admin-1' } } }),
    },
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'in', 'limit']) c[m] = () => c;
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        let r: unknown = { data: [], error: null };
        if (tavola === 'categories') r = { data: [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }], error: null };
        if (tavola === 'profiles') r = { data: [{ id: 'n1', store_name: 'Pane Quotidiano', offers_express: false }], error: null };
        return Promise.resolve(r).then(ok, ko);
      };
      return c;
    },
  },
}));
// Il modulo è quello vero: gli si passano solo dei valori già compilati e validi.
vi.mock('@/components/seller/ProductForm', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/components/seller/ProductForm')>();
  const { createElement: ce } = await import('react');
  const PRONTO = {
    name: 'Poltrona in velluto', description: 'Poltrona in velluto verde, come nuova, ritiro in negozio',
    price: 120, unit: 'pezzo' as const, stock: 1, category_id: 'c1', images: ['https://x/1.jpg'],
    attributes: {}, tags: [], status: 'available', variants: [],
  };
  return {
    ...vero,
    default: (p: Record<string, unknown>) => ce(vero.default as never, { ...p, initialValues: PRONTO, aiAccesa: false } as never),
  };
});

const { default: Pagina } = await import('@/app/admin/products/new/page');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.unstubAllGlobals();
  mondo.spinte = [];
});

describe('R02-006 · «nuovo prodotto» dell\'amministrazione: due invii ravvicinati', () => {
  it('il secondo invio mentre l\'inserimento è in volo non crea un altro prodotto', async () => {
    const chiamate: string[] = [];
    let rispondi: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      chiamate.push(String(url));
      return new Promise<Response>((r) => { rispondi = r; });
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    c = document.createElement('div');
    document.body.appendChild(c);
    root = createRoot(c);
    await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))));
    for (let i = 0; i < 6; i++) await pausa();

    const negozio = c.querySelector('select') as HTMLSelectElement;
    expect(negozio, 'controprova: la tendina dei negozi c\'è').toBeTruthy();
    await act(async () => {
      negozio.value = 'n1';
      negozio.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const modulo = c.querySelector('form') as HTMLFormElement;
    expect(modulo, 'controprova: il modulo del prodotto c\'è').toBeTruthy();
    const invia = () => modulo.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await act(async () => { invia(); });
    for (let i = 0; i < 5; i++) await pausa(10);
    expect(chiamate.filter((u) => u === '/api/admin/products'), 'controprova: il primo invio parte').toHaveLength(1);

    // L'inserimento è ancora in volo: un secondo invio ravvicinato non deve ripartire.
    await act(async () => { invia(); });
    for (let i = 0; i < 5; i++) await pausa(10);
    expect(chiamate.filter((u) => u === '/api/admin/products'), 'il secondo invio ha creato un doppione').toHaveLength(1);

    // Finito l'inserimento, la pagina va all'elenco come prima.
    await act(async () => {
      rispondi(new Response(JSON.stringify({ data: { id: 'p-nuovo' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    for (let i = 0; i < 5; i++) await pausa(10);
    expect(mondo.spinte).toContain('/admin/products');
    expect(chiamate.filter((u) => u === '/api/admin/products')).toHaveLength(1);
  });
});
