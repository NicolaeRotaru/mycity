/**
 * @vitest-environment jsdom
 */
/**
 * R16-021 — Se le categorie non arrivavano, il modulo «Nuovo prodotto» si apriva con il campo
 * Categoria vuoto e, al «Pubblica», chiedeva di scegliere una categoria che non c'era: il ripiego
 * `= []` faceva passare una lettura caduta per «non ci sono categorie». La pagina di modifica ha
 * già l'avviso «Non riesco a leggere le categorie» con «Riprova»; quella nuova no.
 *
 * Qui si monta la pagina con un Supabase finto la cui lettura delle categorie cade: niente
 * modulo, l'avviso con «Riprova», e «Riprova» rilegge davvero e apre il modulo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen } from '@testing-library/dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

const stato = vi.hoisted(() => {
  type Esito = { data: unknown; error: unknown };
  const s = {
    /** Cosa risponde la lettura delle categorie. */
    categorie: { data: null, error: null } as Esito,
    letture: 0,
    client: null as unknown,
  };
  const catena = (finale: () => Esito) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c;
    c.maybeSingle = async () => ({ data: null, error: null });
    c.single = c.maybeSingle;
    c.then = (ok: (r: Esito) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(finale()).then(ok, ko);
    return c;
  };
  s.client = {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } }, error: null }) },
    from: (tavola: string) => {
      if (tavola === 'categories') return catena(() => { s.letture += 1; return s.categorie; });
      return catena(() => ({ data: [], error: null }));
    },
  };
  return s;
});

vi.mock('@/lib/supabase/client', () => ({ supabase: stato.client }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: true, inLettura: false, nonLetta: false }),
}));
vi.mock('@/components/seller/SellerPageTitle', () => ({ default: () => null }));
vi.mock('@/components/products/ImportFromUrlBox', () => ({ default: () => null }));
vi.mock('@/components/seller/BulkPhotoCreate', () => ({ default: () => null }));
vi.mock('@/components/seller/ProductForm', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: { categories: unknown[] }) => ce('p', null, `MODULO con ${p.categories.length} categorie`) };
});

import { queryKeys } from '@/lib/queries/keys';
import NewProductPage from '@/app/seller/products/new/page';

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
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(NewProductPage))); });
  await aspetta(30);
  return radice;
}

beforeEach(() => {
  stato.letture = 0;
});

afterEach(() => {
  onlineManager.setOnline(true);
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('R16-021 · «Nuovo prodotto» senza categorie lette', () => {
  it('niente modulo con l\'elenco vuoto: l\'avviso «Non riesco a leggere le categorie» con «Riprova», che rilegge', async () => {
    stato.categorie = { data: null, error: { message: 'boom', code: '500' } };
    const radice = await apri();
    expect(radice.textContent).not.toContain('MODULO');
    expect(radice.textContent).toContain('Non riesco a leggere le categorie');
    const riprova = screen.getByRole('button', { name: 'Riprova' });

    stato.categorie = { data: [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }], error: null };
    const prima = stato.letture;
    await act(async () => { riprova.click(); });
    await aspetta(30);
    expect(stato.letture).toBeGreaterThan(prima);
    expect(radice.textContent).toContain('MODULO con 1 categorie');
  });

  it('con le categorie lette il modulo si apre, senza avviso', async () => {
    stato.categorie = { data: [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }], error: null };
    const radice = await apri();
    expect(radice.textContent).toContain('MODULO con 1 categorie');
    expect(radice.textContent).not.toContain('Non riesco a leggere le categorie');
  });
});

describe('R16-021 · «Nuovo prodotto» senza rete: categorie in pausa', () => {
  it('rete assente e nessuna categoria in memoria: l\'avviso con «Riprova», non il modulo con 0 categorie', async () => {
    onlineManager.setOnline(false);
    try {
      const radice = await apri();
      expect(radice.textContent).not.toContain('MODULO');
      expect(radice.textContent).toContain('Non riesco a leggere le categorie');
      expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('rete assente ma categorie già in memoria: il modulo si apre', async () => {
    onlineManager.setOnline(false);
    try {
      const radice = await apri((qc) => {
        qc.setQueryData(queryKeys.categories.form, [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }]);
      });
      expect(radice.textContent).toContain('MODULO con 1 categorie');
      expect(radice.textContent).not.toContain('Non riesco a leggere le categorie');
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
