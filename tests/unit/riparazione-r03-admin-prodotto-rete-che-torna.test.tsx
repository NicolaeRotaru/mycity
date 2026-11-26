/**
 * @vitest-environment jsdom
 */
/**
 * R03-008 — Nella modifica prodotto dell'amministrazione: (1) tornata la rete, la rilettura rimetteva
 * il caricamento al posto del modulo e le modifiche scritte si perdevano; (2) senza rete il modulo si
 * apriva con 0 taglie, o diceva «Prodotto non trovato» invece di «Riprova». Come nella pagina del negozio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

type Riga = Record<string, unknown>;

const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  aperture: [] as Array<Record<string, unknown>>,
  variantiRotte: false,
  letturaProdottoRotta: false,
  letture: 0,
  lettureVarianti: 0,
  montaggi: 0,
  smontaggi: 0,
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
  usePathname: () => '/seller/products',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => {
  const { createElement: crea } = await vi.importActual<typeof import('react')>('react');
  return { default: ({ href, children }: { href: unknown; children?: ReactNode }) => crea('a', { href: String(href) }, children) };
});
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'seller-1' } } }) },
    from: (tavola: string) => ({
      select() {
        const filtri: Array<[string, unknown]> = [];
        const trova = () => (stato.tabelle[tavola] ?? []).filter((r) => filtri.every(([c, v]) => r[c] === v)).map((r) => ({ ...r }));
        const catena = {
          eq: (c: string, v: unknown) => (filtri.push([c, v]), catena),
          order: () => catena,
          // Come il client vero: un guasto è un oggetto con message, non un Error.
          single: async () => (tavola === 'products' && stato.letturaProdottoRotta
            ? { data: null, error: { message: 'FetchError', code: '' } }
            : trova()[0] ? { data: trova()[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }),
          maybeSingle: async () => {
            if (tavola === 'products') stato.letture++;
            return tavola === 'products' && stato.letturaProdottoRotta
              ? { data: null, error: { message: 'FetchError', code: '' } }
              : { data: trova()[0] ?? null, error: null };
          },
          then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve({ data: trova(), error: null }).then(ok, ko),
        };
        return catena;
      },
    }),
  },
}));
vi.mock('@/lib/products/salva-dal-browser', () => ({ salvaProdottoDalBrowser: async () => [] }));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async (id: string) => {
    stato.lettureVarianti++;
    // Come il database: un id che non è un uuid dà un errore di sintassi.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('invalid input syntax for type uuid');
    if (stato.variantiRotte) throw new Error('Failed to fetch');
    return [
      { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3, position: 0 },
      { id: 'v-l', options: { Taglia: 'L' }, label: 'L', stock: 2, position: 1 },
    ];
  },
}));
vi.mock('@/components/admin/ExternalDataPanel', () => ({ default: () => null }));
vi.mock('@/lib/products/persistVariantsServer', () => ({ saveProductVariantsServer: async () => undefined }));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
vi.mock('@/components/seller/ProductForm', () => ({
  default: function ModuloFinto(props: { initialValues?: Riga }) {
    stato.aperture.push(props.initialValues ?? {});
    useEffect(() => {
      stato.montaggi++;
      return () => { stato.smontaggi++; };
    }, []);
    return null;
  },
}));

const ID = '11111111-1111-4111-8111-111111111111';

function maglietta(extra: Riga = {}): Riga {
  return {
    id: ID, seller_id: 'seller-1', name: 'Maglietta', description: 'Cotone pesante, stampata a mano.',
    price: 18, compare_at_price: null, unit: 'pezzo', condition: 'new', stock: 5, category_id: 'cat-1',
    images: ['https://mycity.test/maglietta.jpg'], attributes: {}, tags: [], express_enabled: null,
    status: 'available', ...extra,
  };
}

let root: Root | null = null;
let radice: HTMLElement | null = null;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stato.tabelle = { categories: [], products: [maglietta()] };
  stato.aperture = [];
  stato.variantiRotte = false;
  stato.letturaProdottoRotta = false;
  stato.letture = 0;
  stato.lettureVarianti = 0;
  stato.montaggi = 0;
  stato.smontaggi = 0;
  onlineManager.setOnline(true);
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
});

afterEach(() => {
  act(() => root?.unmount());
  radice?.remove();
});


function client() { return new QueryClient({ defaultOptions: { queries: { retry: false } } }); }
async function apri(qc: QueryClient, id: string = ID) {
  const { default: Pagina } = await import('@/app/admin/products/[id]/edit/page');
  act(() =>
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { valore: { id } } }))),
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

function testo() { return radice!.textContent ?? ''; }


const RIGA = { ...maglietta() };
const TAGLIE = [{ id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3, position: 0 }];
const chiaveVarianti = () => [...queryKeys.admin.product(ID), 'variants'];

describe('R03-008 · la pagina admin del prodotto con la rete che va e viene', () => {
  it('senza rete e senza il prodotto in memoria dice «Riprova», non «Prodotto non trovato»', async () => {
    onlineManager.setOnline(false);
    await apri(client());
    expect(testo()).toMatch(/Non riesco a leggere questo prodotto/);
    expect(testo()).not.toMatch(/Prodotto non trovato/);
    expect([...radice!.querySelectorAll('button')].some((b) => b.textContent === 'Riprova')).toBe(true);
    expect(stato.aperture).toHaveLength(0);
  });

  it('senza rete, col prodotto in memoria ma senza taglie, il modulo non si apre con 0 taglie', async () => {
    onlineManager.setOnline(false);
    const qc = client();
    qc.setQueryData(queryKeys.admin.product(ID), RIGA);
    await apri(qc);
    expect(stato.aperture, 'il modulo si e\' aperto senza taglie').toHaveLength(0);
    expect(testo()).toMatch(/Non riesco a leggere le taglie/);
    expect([...radice!.querySelectorAll('button')].some((b) => b.textContent === 'Riprova')).toBe(true);
  });

  it('aperto dalla memoria senza rete, quando la rete torna il modulo non si smonta', async () => {
    onlineManager.setOnline(false);
    const qc = client();
    qc.setQueryData(queryKeys.admin.product(ID), RIGA);
    qc.setQueryData(chiaveVarianti(), TAGLIE);
    await apri(qc);
    expect(stato.montaggi).toBe(1);
    const letture = stato.lettureVarianti;
    await act(async () => { onlineManager.setOnline(true); await new Promise((r) => setTimeout(r, 50)); });
    expect(stato.lettureVarianti, 'la rilettura non e\' partita').toBeGreaterThan(letture);
    expect(stato.smontaggi, 'il modulo si e\' smontato al ritorno della rete').toBe(0);
    expect(stato.montaggi).toBe(1);
  });
});
