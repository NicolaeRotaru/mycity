/**
 * @vitest-environment jsdom
 */
/**
 * R22-017 — Se la lettura del prodotto cade, la pagina di modifica dell'amministrazione
 * non deve dire «Prodotto non trovato»: dice che la lettura non è riuscita e offre «Riprova».
 * Un prodotto davvero assente (nessuna riga, nessun errore) dice ancora che non esiste.
 *
 * La pagina del negozio si fermava gia' se le taglie non si leggevano; quella
 * dell'amministrazione no: `variants` restava [] e il modulo si apriva senza
 * taglie. Al «Salva» la PATCH riceveva le varianti vuote. Ora si ferma e dice
 * di ricaricare.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = Record<string, unknown>;

const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  aperture: [] as Array<Record<string, unknown>>,
  variantiRotte: false,
  letturaProdottoRotta: false,
  letture: 0,
  lettureVarianti: 0,
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

async function finche(condizione: () => boolean) {
  for (let i = 0; i < 80 && !condizione(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stato.tabelle = { categories: [], products: [maglietta()] };
  stato.aperture = [];
  stato.variantiRotte = false;
  stato.letturaProdottoRotta = false;
  stato.letture = 0;
  stato.lettureVarianti = 0;
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
});

afterEach(() => {
  act(() => root?.unmount());
  radice?.remove();
});


async function apri(id: string = ID) {
  const { default: Pagina } = await import('@/app/admin/products/[id]/edit/page');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { valore: { id } } }))),
  );
  await finche(() => stato.aperture.length > 0 || (radice!.textContent ?? '').includes('Errore'));
}


function testo() { return radice!.textContent ?? ''; }

describe('R22-017 · lettura caduta e prodotto assente si dicono diversi', () => {
  it('la lettura cade: dice che non è riuscita, con «Riprova», e non «Prodotto non trovato»', async () => {
    stato.letturaProdottoRotta = true;
    await apri();
    expect(testo()).toMatch(/Non riesco a leggere questo prodotto/);
    expect(testo()).not.toMatch(/Prodotto non trovato/);
    const riprova = [...radice!.querySelectorAll('button')].find((b) => b.textContent === 'Riprova');
    expect(riprova, 'manca «Riprova»').toBeTruthy();
    const prima = stato.letture;
    await act(async () => { riprova!.click(); });
    await finche(() => stato.letture > prima);
    expect(stato.letture).toBeGreaterThan(prima);
    expect(stato.aperture).toHaveLength(0);
  });

  it('il prodotto manca davvero: dice che non esiste', async () => {
    stato.tabelle = { categories: [], products: [] };
    await apri();
    expect(testo()).toMatch(/Prodotto non trovato/);
    expect(testo()).not.toMatch(/Non riesco a leggere questo prodotto/);
    expect([...radice!.querySelectorAll('button')].some((b) => b.textContent === 'Riprova')).toBe(false);
  });

  it('con un codice storto («abc») dice «Prodotto non trovato», senza parlare di taglie e senza leggere le varianti', async () => {
    await apri('abc');
    await finche(() => testo().includes('Prodotto non trovato'));
    expect(testo()).toMatch(/Prodotto non trovato/);
    expect(testo()).not.toMatch(/taglie|varianti/i);
    expect([...radice!.querySelectorAll('button')].some((b) => b.textContent === 'Riprova')).toBe(false);
    expect(stato.lettureVarianti, 'le varianti sono state lette con un id che non è un codice').toBe(0);
  });

  it('controprova: con il prodotto letto il modulo si apre', async () => {
    await apri();
    expect(stato.aperture.length).toBeGreaterThan(0);
  });
});
