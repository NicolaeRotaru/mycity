/**
 * @vitest-environment jsdom
 */
/**
 * R16-004 — Il salvataggio di un prodotto faceva due passi: prima il prodotto (nome, prezzo),
 * poi le varianti. Se le varianti cadevano (una taglia venduta fra il controllo e la scrittura,
 * la rete che salta sulla cancellazione di una taglia), il prezzo nuovo restava salvato e le
 * varianti no.
 *
 * Qui il salvataggio gira su un database finto: la focaccia costa 4, il negoziante la porta a 5
 * e cambia il nome, le varianti non passano. Dopo, nel database la focaccia deve essere com'era:
 * stesso nome, prezzo 4. Due porte: la pagina «Modifica prodotto» del negozio e la rotta
 * dell'amministratore (PATCH /api/admin/products).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = Record<string, unknown>;

const PRODOTTO_ID = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

const stato = vi.hoisted(() => {
  type R = Record<string, unknown>;
  const s = {
    db: { products: [] as R[], product_variants: [] as R[] } as Record<'products' | 'product_variants', R[]>,
    /** Cosa risponde la funzione delle varianti: null = va, un errore = cade. */
    esitoVarianti: null as null | { code: string; message: string; details?: string },
    toastOk: vi.fn(),
    toastErr: vi.fn(),
    client: null as unknown,
  };
  /** Una lettura/scrittura finta che rispetta i suoi `.eq()`. */
  function tavola(nome: 'products' | 'product_variants') {
    const righe = () => s.db[nome];
    return {
      select() {
        const filtri: Array<[string, unknown]> = [];
        const trova = () => righe().filter((r) => filtri.every(([c, v]) => r[c] === v)).map((r) => ({ ...r }));
        const c = {
          eq(col: string, v: unknown) { filtri.push([col, v]); return c; },
          order() { return c; },
          async single() { const [r] = trova(); return { data: r ?? null, error: r ? null : { code: 'PGRST116', message: 'nessuna riga' } }; },
          async maybeSingle() { const [r] = trova(); return { data: r ?? null, error: null }; },
          then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
            return Promise.resolve({ data: trova(), error: null }).then(ok, ko);
          },
        };
        return c;
      },
      update(valori: R) {
        const filtri: Array<[string, unknown]> = [];
        const applica = () => {
          const colpite = righe().filter((r) => filtri.every(([col, v]) => r[col] === v));
          colpite.forEach((r) => Object.assign(r, valori));
          return colpite;
        };
        const c = {
          eq(col: string, v: unknown) { filtri.push([col, v]); return c; },
          async select() { return { data: applica().map((r) => ({ id: r.id })), error: null }; },
          then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
            applica();
            return Promise.resolve({ error: null }).then(ok, ko);
          },
        };
        return c;
      },
    };
  }

  const clientFinto = {
    from: (nome: string) => {
      if (nome === 'categories') {
        return { select: () => ({ order: async () => ({ data: [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }], error: null }) }) };
      }
      if (nome === 'profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'seller' }, error: null }) }) }) };
      }
      return tavola(nome as 'products' | 'product_variants');
    },
    // La funzione del database che salva le varianti in una transazione sola (migrazione 323):
    // qui risponde quello che decide la prova, e se cade non scrive niente.
    rpc: async (nome: string) => {
      if (nome !== 'salva_varianti') throw new Error(`rpc inattesa: ${nome}`);
      return { data: null, error: s.esitoVarianti };
    },
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } }, error: null }) },
  };
  s.client = clientFinto;
  return s;
});
function focaccia(): Riga {
  return {
    id: PRODOTTO_ID, seller_id: 'negozio-1', name: 'Focaccia genovese', description: 'Con olio extravergine.',
    price: 4, compare_at_price: null, unit: 'pezzo', condition: null, stock: 2, category_id: 'cat-1',
    images: ['https://mycity.test/focaccia.jpg'], attributes: {}, tags: [], express_enabled: true, status: 'available',
  };
}
const prodotto = () => stato.db.products.find((r) => r.id === PRODOTTO_ID) as Riga;

// React 18 non ha `use`: i parametri della pagina arrivano già pronti.
vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: stato.client }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (fn: (a: { user: { id: string }; req: Request }) => unknown) => (req: Request) => fn({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: stato.toastOk, error: stato.toastErr } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }) }));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: true, inLettura: false, nonLetta: false }),
}));
// La porta del prodotto (PATCH /api/seller/products/:id) scrive sul database finto, con la
// condizione sulla scorta vista come la porta vera.
vi.mock('@/lib/products/salva-dal-browser', () => ({
  salvaProdottoDalBrowser: async (o: { payload: Riga }) => {
    const { stock_visto: vista, stock_confermato: _c, ...campi } = o.payload;
    const riga = prodotto();
    if ('stock' in campi && typeof vista === 'number' && riga.stock !== vista) throw new Error('La scorta è cambiata');
    Object.assign(riga, campi);
    return Object.keys(campi);
  },
  nascondiProdottoTracciato: async () => undefined,
}));
// Il modulo vero è grande e non c'entra: qui un pulsante che manda il nome e il prezzo nuovi,
// con la taglia S (scorta vista 2, portata a 3).
vi.mock('@/components/seller/ProductForm', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: (p: { onSubmit: (payload: Riga, ctx: Riga) => void }) =>
      ce('button', {
        type: 'button',
        onClick: () => p.onSubmit(
          { name: 'Focaccia al rosmarino', price: 5 },
          { intent: 'save', variants: [{ id: S, options: { Taglia: 'S' }, label: 'S', stock: 3 }], campiDallAi: [], scorteViste: { [S]: 2 } },
        ),
      }, 'Salva modifiche'),
  };
});

import EditProductPage from '@/app/seller/products/[id]/edit/page';
import { PATCH } from '@/app/api/admin/products/route';

const accesi: Root[] = [];
const aspetta = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  stato.db.products = [focaccia()];
  stato.db.product_variants = [{ id: S, product_id: PRODOTTO_ID, options: { Taglia: 'S' }, label: 'S', stock: 2, position: 0 }];
  stato.esitoVarianti = null;
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

async function salvaDallaPagina() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(EditProductPage as never, { params: { valore: { id: PRODOTTO_ID } } })));
  });
  await aspetta(30);
  const salva = await screen.findByRole('button', { name: 'Salva modifiche' });
  await act(async () => { salva.click(); });
  await aspetta(30);
}

describe('R16-004 · la pagina «Modifica prodotto» salva tutto o niente', () => {
  it('se le varianti cadono (la S venduta proprio in quel momento), nome e prezzo restano com\'erano', async () => {
    stato.esitoVarianti = { code: 'P0001', message: 'scorta_cambiata', details: S };
    await salvaDallaPagina();
    expect(stato.toastErr).toHaveBeenCalledTimes(1);
    expect(prodotto().price, 'il prezzo nuovo è rimasto salvato, le varianti no').toBe(4);
    expect(prodotto().name).toBe('Focaccia genovese');
    expect(stato.toastOk).not.toHaveBeenCalled();
  });

  it('se cade la rete sulle varianti, il prodotto torna com\'era', async () => {
    stato.esitoVarianti = { code: '', message: 'TypeError: Failed to fetch' };
    await salvaDallaPagina();
    expect(stato.toastErr).toHaveBeenCalledTimes(1);
    expect(prodotto().price).toBe(4);
    expect(prodotto().name).toBe('Focaccia genovese');
  });

  it('se le varianti passano, il prezzo nuovo resta (la prova non gira a vuoto)', async () => {
    await salvaDallaPagina();
    expect(stato.toastOk).toHaveBeenCalledTimes(1);
    expect(prodotto().price).toBe(5);
    expect(prodotto().name).toBe('Focaccia al rosmarino');
  });
});

function richiesta(corpo: Riga): Request {
  return new Request('http://localhost/api/admin/products', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}
const corpoAdmin = () => ({
  id: PRODOTTO_ID, name: 'Focaccia al rosmarino', price: 5,
  variants: [{ id: S, options: { Taglia: 'S' }, label: 'S', stock: 3 }], scorteViste: { [S]: 2 },
});
const chiama = (corpo: Riga) => (PATCH as unknown as (r: Request) => Promise<Response>)(richiesta(corpo));

describe('R16-004 · la rotta dell\'amministratore salva tutto o niente', () => {
  it('se le varianti cadono dopo la scrittura del prodotto, il prodotto torna com\'era', async () => {
    stato.esitoVarianti = { code: 'P0001', message: 'scorta_cambiata', details: S };
    const r = await chiama(corpoAdmin());
    expect(r.ok).toBe(false);
    expect(prodotto().price, 'il prezzo nuovo è rimasto salvato, le varianti no').toBe(4);
    expect(prodotto().name).toBe('Focaccia genovese');
  });

  it('se la scorta della S è già cambiata, non scrive niente prima di provarci', async () => {
    stato.db.product_variants[0].stock = 1;
    const r = await chiama(corpoAdmin());
    expect(r.status).toBe(409);
    expect(prodotto().price).toBe(4);
  });

  it('se le varianti passano, il prezzo nuovo resta', async () => {
    const r = await chiama(corpoAdmin());
    expect(r.ok).toBe(true);
    expect(prodotto().price).toBe(5);
  });
});
