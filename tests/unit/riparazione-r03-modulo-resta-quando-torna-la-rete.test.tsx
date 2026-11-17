/**
 * @vitest-environment jsdom
 */
/**
 * R03-019 — Quando la rete tornava, le pagine prodotto del negoziante rimettevano il caricamento
 * al posto del modulo e le modifiche non salvate si perdevano. Senza rete le letture senza dati
 * (la consegna del negozio, la rilettura del prodotto) restano «in pausa» e il modulo si apre lo
 * stesso; tornata la rete ripartono, risultano «in lettura», e la pagina smontava il modulo.
 *
 * Qui react-query vero e Supabase finto: si apre la pagina senza rete, si torna in rete, e il
 * modulo (finto) deve essersi montato UNA volta sola, senza caricamento in mezzo. Se si e' aperto
 * senza sapere la consegna del negozio, per lui resta «non letta».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

const ID = '11111111-1111-4111-8111-111111111111';

const stato = vi.hoisted(() => {
  type Esito = { data: unknown; error: unknown };
  const s = {
    cerca: '',
    montaggi: 0,
    caricamenti: 0,
    moduli: [] as Array<Record<string, unknown>>,
    client: null as unknown,
  };
  const PRODOTTO = {
    id: '11111111-1111-4111-8111-111111111111', seller_id: 'negozio-1', name: 'Quaderno', description: 'A righe.', price: 4,
    compare_at_price: null, unit: 'pezzo', condition: null, stock: 3, category_id: 'cat-1', images: [],
    attributes: {}, tags: [], express_enabled: null, status: 'available',
  };
  const catena = (finale: () => Esito) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c;
    c.single = async () => finale();
    c.maybeSingle = async () => finale();
    c.then = (ok: (r: Esito) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(finale()).then(ok, ko);
    return c;
  };
  s.client = {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } }, error: null }) },
    from: (tavola: string) => {
      if (tavola === 'categories') return catena(() => ({ data: [{ id: 'cat-1', name: 'Casa', slug: 'casa', parent_id: null }], error: null }));
      if (tavola === 'profiles') return catena(() => ({ data: { offers_express: true }, error: null }));
      return catena(() => ({ data: PRODOTTO, error: null }));
    },
  };
  return s;
});

vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: stato.client }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(stato.cerca),
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async () => [{ id: 'v1', name: 'Taglia M', options: { Taglia: 'M' }, price: null, stock: 2 }],
  saveProductVariants: async () => undefined,
  controllaScorteVariantiDalBrowser: async () => undefined,
}));
vi.mock('@/components/ui/LoadingState', async () => {
  const { createElement: ce } = await import('react');
  return { LoadingState: () => { stato.caricamenti += 1; return ce('p', null, 'CARICAMENTO'); } };
});
vi.mock('@/components/seller/ProductForm', async () => {
  const { createElement: ce, useEffect } = await import('react');
  function ModuloFinto(p: Record<string, unknown>) {
    useEffect(() => { stato.montaggi += 1; }, []);
    stato.moduli.push(p);
    return ce('p', null, 'MODULO');
  }
  return { default: ModuloFinto };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: NuovoProdotto } = await import('@/app/seller/products/new/page');
const { default: ModificaProdotto } = await import('@/app/seller/products/[id]/edit/page');

const CATEGORIE = [{ id: 'cat-1', name: 'Casa', slug: 'casa', parent_id: null }];
const accesi: Root[] = [];
let radice: HTMLDivElement | null = null;
const gira = async (volte = 8) => {
  for (let i = 0; i < volte; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
};

async function monta(pagina: unknown, props: Record<string, unknown>, prepara: (qc: QueryClient) => void) {
  radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  prepara(qc);
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(pagina as never, props))); });
  await gira();
}

const testo = () => radice?.textContent ?? '';
const ultimoModulo = () => stato.moduli.at(-1) ?? {};

beforeEach(() => {
  stato.cerca = '';
  stato.montaggi = 0;
  stato.caricamenti = 0;
  stato.moduli = [];
  onlineManager.setOnline(true);
});

afterEach(async () => {
  for (const r of accesi.splice(0)) await act(async () => { r.unmount(); });
  document.body.innerHTML = '';
  radice = null;
  onlineManager.setOnline(true);
});

describe('quando torna la rete il modulo prodotto resta dov\'e\'', () => {
  it('«Nuovo prodotto» aperto senza rete: tornata la rete niente caricamento al posto del modulo, che non si rimonta', async () => {
    onlineManager.setOnline(false);
    await monta(NuovoProdotto, {}, (qc) => qc.setQueryData(queryKeys.categories.form, CATEGORIE));
    expect(testo()).toContain('MODULO');
    expect(stato.montaggi).toBe(1);
    expect(ultimoModulo().consegnaDelNegozioNonLetta).toBe(true);
    const caricamentiPrima = stato.caricamenti;

    await act(async () => { onlineManager.setOnline(true); });
    await gira();
    expect(stato.caricamenti, 'il caricamento ha preso il posto del modulo').toBe(caricamentiPrima);
    expect(stato.montaggi, 'il modulo si e\' rimontato: le modifiche non salvate sono perse').toBe(1);
    expect(testo()).toContain('MODULO');
    // Si e' aperto senza sapere la consegna del negozio: per lui resta «non letta».
    expect(ultimoModulo().consegnaDelNegozioNonLetta).toBe(true);
  });

  it('«Modifica prodotto» aperto senza rete: tornata la rete il modulo non lascia il posto al caricamento', async () => {
    onlineManager.setOnline(false);
    await monta(ModificaProdotto, { params: { valore: { id: ID } } }, (qc) => {
      qc.setQueryData(queryKeys.categories.form, CATEGORIE);
      qc.setQueryData(queryKeys.seller.product(ID), { id: ID, seller_id: 'negozio-1', name: 'Quaderno', price: 4, stock: 3, category_id: 'cat-1', images: [], attributes: {}, tags: [], express_enabled: null, status: 'available' });
      qc.setQueryData([...queryKeys.seller.product(ID), 'variants'], []);
    });
    expect(testo()).toContain('MODULO');
    expect(stato.montaggi).toBe(1);
    const caricamentiPrima = stato.caricamenti;

    await act(async () => { onlineManager.setOnline(true); });
    await gira();
    expect(stato.caricamenti, 'il caricamento ha preso il posto del modulo').toBe(caricamentiPrima);
    expect(stato.montaggi, 'il modulo si e\' rimontato: le modifiche non salvate sono perse').toBe(1);
    expect(ultimoModulo().consegnaDelNegozioNonLetta).toBe(true);
  });

  it('«Duplica» con le taglie in pausa: il modulo non si apre senza, e tornata la rete si apre una volta con le taglie', async () => {
    stato.cerca = 'from=p-pane';
    onlineManager.setOnline(false);
    await monta(NuovoProdotto, {}, (qc) => {
      qc.setQueryData(queryKeys.categories.form, CATEGORIE);
      qc.setQueryData(['duplicate-source', 'p-pane'], { id: 'p-pane', seller_id: 'negozio-1', name: 'Pane', price: 4, images: [], attributes: {} });
    });
    expect(testo()).not.toContain('MODULO');
    expect(testo()).toMatch(/Non riesco a leggere le taglie/);

    await act(async () => { onlineManager.setOnline(true); });
    await gira();
    expect(testo()).toContain('MODULO');
    expect(stato.montaggi).toBe(1);
    expect(((ultimoModulo().initialValues as { variants?: unknown[] } | undefined)?.variants ?? []).length).toBe(1);
  });
});
