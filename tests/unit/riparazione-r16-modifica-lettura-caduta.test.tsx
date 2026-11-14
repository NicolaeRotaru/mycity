/**
 * @vitest-environment jsdom
 */
/**
 * R16-020 — Se la lettura del prodotto non riusciva (il database risponde 500, la rete cade), la
 * pagina «Modifica prodotto» diceva «Prodotto non trovato» e non offriva «Riprova»: l'errore di
 * Supabase non è un Error di JavaScript, e il ramo d'errore ricadeva su «non trovato». Il
 * negoziante credeva il prodotto sparito e rischiava di ricrearlo.
 *
 * Qui si monta la pagina con un Supabase finto: una lettura caduta deve dire che non riesce a
 * leggere e offrire «Riprova», che rilegge davvero; «Prodotto non trovato» resta solo quando la
 * lettura riesce e il prodotto non c'è.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen } from '@testing-library/dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queries/keys';

const ID = '11111111-1111-4111-8111-111111111111';

const stato = vi.hoisted(() => {
  type Esito = { data: unknown; error: unknown };
  const s = {
    /** Cosa risponde la lettura del prodotto. */
    lettura: { data: null, error: null } as Esito,
    letture: 0,
    utente: { data: { user: { id: 'negozio-1' } }, error: null } as unknown,
    client: null as unknown,
  };
  const catena = (finale: () => Esito) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) c[m] = () => c;
    c.single = async () => { s.letture += 1; return s.lettura; };
    c.maybeSingle = async () => s.lettura;
    c.then = (ok: (r: Esito) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(finale()).then(ok, ko);
    return c;
  };
  s.client = {
    auth: { getUser: async () => s.utente },
    from: (tavola: string) => {
      if (tavola === 'categories') return catena(() => ({ data: [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }], error: null }));
      if (tavola === 'product_variants') return catena(() => ({ data: [], error: null }));
      return catena(() => s.lettura);
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
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: true, inLettura: false, nonLetta: false }),
}));
vi.mock('@/components/seller/ProductForm', async () => {
  const { createElement: ce } = await import('react');
  return { default: () => ce('p', null, 'MODULO') };
});

import EditProductPage from '@/app/seller/products/[id]/edit/page';

const PRODOTTO = {
  id: ID, seller_id: 'negozio-1', name: 'Quaderno da modificare', description: 'Quaderno a righe.', price: 4,
  compare_at_price: null, unit: 'pezzo', condition: null, stock: 3, category_id: 'cat-1', images: [],
  attributes: {}, tags: [], express_enabled: true, status: 'available',
};

const accesi: Root[] = [];
const aspetta = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function apri(prepara?: (qc: QueryClient) => void) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepara?.(qc);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(EditProductPage as never, { params: { valore: { id: ID } } })));
  });
  await aspetta(30);
  return radice;
}

beforeEach(() => {
  stato.letture = 0;
  stato.utente = { data: { user: { id: 'negozio-1' } }, error: null };
});

afterEach(() => {
  onlineManager.setOnline(true);
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('R16-020 · la lettura del prodotto caduta non è «Prodotto non trovato»', () => {
  it('il database risponde 500: dice che non riesce a leggere e offre «Riprova», che rilegge', async () => {
    stato.lettura = { data: null, error: { message: 'boom', code: '500' } };
    const radice = await apri();
    expect(radice.textContent).not.toContain('Prodotto non trovato');
    expect(radice.textContent).toContain('Non riesco a leggere il prodotto');
    const riprova = screen.getByRole('button', { name: 'Riprova' });

    stato.lettura = { data: PRODOTTO, error: null };
    const prima = stato.letture;
    await act(async () => { riprova.click(); });
    await aspetta(30);
    expect(stato.letture).toBeGreaterThan(prima);
    expect(radice.textContent).toContain('MODULO');
  });

  it('senza rete: niente parole tecniche, niente «non trovato», e c\'è «Riprova»', async () => {
    stato.lettura = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    const radice = await apri();
    expect(radice.textContent).not.toContain('Prodotto non trovato');
    expect(radice.textContent).not.toContain('Failed to fetch');
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
  });

  it('la lettura riesce e il prodotto non c\'è: «Prodotto non trovato», senza «Riprova»', async () => {
    stato.lettura = { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
    const radice = await apri();
    expect(radice.textContent).toContain('Prodotto non trovato');
    expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
  });

  it('il prodotto di un altro negozio: il messaggio di sempre, senza «Riprova»', async () => {
    stato.lettura = { data: { ...PRODOTTO, seller_id: 'negozio-2' }, error: null };
    const radice = await apri();
    expect(radice.textContent).toContain('Non puoi modificare un prodotto che non è tuo');
    expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
  });

  it('getUser cade per la rete: «Riprova», non «Non autenticato»', async () => {
    stato.utente = { data: { user: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } };
    const radice = await apri();
    expect(radice.textContent).not.toContain('Non autenticato');
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
  });

  it('la sessione è davvero mancante: resta «Non autenticato», senza «Riprova»', async () => {
    stato.utente = { data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } };
    const radice = await apri();
    expect(radice.textContent).toContain('Non autenticato');
    expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
  });
});

describe('R16-020 · senza rete la lettura del prodotto è in pausa, non «Prodotto non trovato»', () => {
  it('rete assente: «Non riesco a leggere il prodotto» con «Riprova», mai «Prodotto non trovato»', async () => {
    onlineManager.setOnline(false);
    try {
      const radice = await apri((qc) => {
        qc.setQueryData(queryKeys.categories.form, [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }]);
      });
      expect(radice.textContent).not.toContain('Prodotto non trovato');
      expect(radice.textContent).toContain('Non riesco a leggere il prodotto');
      expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
