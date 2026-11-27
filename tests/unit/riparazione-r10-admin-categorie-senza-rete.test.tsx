/**
 * @vitest-environment jsdom
 */
/**
 * R10-012 — La modifica prodotto dell'amministratore, aperta senza rete, partiva con le categorie
 * vuote se l'elenco non era in memoria: la lettura resta «in pausa» (né in caricamento né caduta) e
 * il ripiego `categories = []` apriva il modulo come se non ci fossero categorie. Qui la pagina VERA,
 * con React Query vero messo senza rete (`onlineManager`), e il prodotto e le taglie già in memoria.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

type Riga = Record<string, unknown>;

const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  aperture: [] as Array<{ categorie: number; taglie: number }>,
}));

vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('next-intl', async (importOriginal) => {
  const vero = await importOriginal<Record<string, unknown>>();
  const t = Object.assign((k: string) => k, { rich: (k: string) => k, raw: (k: string) => k, has: () => true });
  return { ...vero, useTranslations: () => t, useLocale: () => 'it' };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/products',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => {
  const { createElement: crea } = await vi.importActual<typeof import('react')>('react');
  return { default: ({ href, children }: { href: unknown; children?: ReactNode }) => crea('a', { href: String(href) }, children) };
});
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (tavola: string) => ({
      select() {
        const filtri: Array<[string, unknown]> = [];
        const trova = () => (stato.tabelle[tavola] ?? []).filter((r) => filtri.every(([c, v]) => r[c] === v)).map((r) => ({ ...r }));
        const catena = {
          eq: (c: string, v: unknown) => (filtri.push([c, v]), catena),
          order: () => catena,
          maybeSingle: async () => ({ data: trova()[0] ?? null, error: null }),
          then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: trova(), error: null }).then(ok, ko),
        };
        return catena;
      },
    }),
  },
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async () => [{ id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3, position: 0 }],
}));
vi.mock('@/components/admin/ExternalDataPanel', () => ({ default: () => null }));
vi.mock('@/components/seller/ProductForm', () => ({
  default: function ModuloFinto(props: { categories: unknown[]; initialValues?: { variants?: unknown[] } }) {
    stato.aperture.push({ categorie: props.categories.length, taglie: props.initialValues?.variants?.length ?? 0 });
    return null;
  },
}));

const ID = '11111111-1111-4111-8111-111111111111';
const CATEGORIE = [{ id: 'cat-1', name: 'Abbigliamento', slug: 'abbigliamento', parent_id: null }];
const TAGLIE = [{ id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3, position: 0 }];

function maglietta(): Riga {
  return {
    id: ID, seller_id: 'seller-1', name: 'Maglietta', description: 'Cotone pesante.', price: 18, compare_at_price: null,
    unit: 'pezzo', condition: 'new', stock: 5, category_id: 'cat-1', images: [], attributes: {}, tags: [],
    express_enabled: null, status: 'available',
  };
}

let root: Root | null = null;
let radice: HTMLElement | null = null;

async function finche(condizione: () => boolean) {
  for (let i = 0; i < 80 && !condizione(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stato.tabelle = { categories: CATEGORIE, products: [maglietta()] };
  stato.aperture = [];
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
});

afterEach(() => {
  act(() => root?.unmount());
  radice?.remove();
  onlineManager.setOnline(true);
});

/** Apre la pagina senza rete, con in memoria quello che `memoria` dice. */
async function apriSenzaRete(memoria: { categorie: boolean }) {
  const { default: Pagina } = await import('@/app/admin/products/[id]/edit/page');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.admin.product(ID), maglietta());
  qc.setQueryData([...queryKeys.admin.product(ID), 'variants'], TAGLIE);
  if (memoria.categorie) qc.setQueryData(queryKeys.categories.form, CATEGORIE);
  onlineManager.setOnline(false);
  act(() =>
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { valore: { id: ID } } }))),
  );
  await finche(() => stato.aperture.length > 0 || (radice!.textContent ?? '').includes('Riprova'));
}

describe('R10-012 — la modifica prodotto dell\'amministratore senza rete e le categorie', () => {
  it('categorie non in memoria: il modulo non si apre con l\'elenco vuoto, la pagina lo dice e offre «Riprova»', async () => {
    await apriSenzaRete({ categorie: false });
    expect(stato.aperture.filter((a) => a.categorie === 0), 'il modulo si è aperto con le categorie vuote').toEqual([]);
    expect(radice!.textContent).toMatch(/categorie/i);
    expect(Array.from(radice!.querySelectorAll('button')).some((b) => b.textContent === 'Riprova')).toBe(true);
  });

  it('quando torna la rete l\'elenco si legge e il modulo si apre con le categorie', async () => {
    await apriSenzaRete({ categorie: false });
    act(() => onlineManager.setOnline(true));
    await finche(() => stato.aperture.length > 0);
    expect(stato.aperture.length).toBeGreaterThan(0);
    expect(stato.aperture.every((a) => a.categorie === 1)).toBe(true);
  });

  it('controprova: con le categorie in memoria il modulo si apre anche senza rete, con le categorie', async () => {
    await apriSenzaRete({ categorie: true });
    expect(stato.aperture.length).toBeGreaterThan(0);
    expect(stato.aperture.every((a) => a.categorie === 1)).toBe(true);
  });
});
