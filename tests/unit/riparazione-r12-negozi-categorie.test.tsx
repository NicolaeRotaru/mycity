/**
 * @vitest-environment jsdom
 */
/**
 * R12 — LA PAGINA DEI NEGOZI E LE SUE CATEGORIE.
 *
 * Se la lettura delle categorie cadeva, i filtri per settore sparivano e la pagina non diceva
 * niente: chi cercava «Panificio» non capiva perché il filtro non c'era. Adesso un avviso breve.
 *
 * La pagina si monta col react-query vero: la lettura dei dati gira davvero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { creaPostgrestColTetto, type Riga } from './aiuti/riparazione-r06-postgrest-col-tetto';

const categorie: Riga[] = [
  { id: 'm-pan', slug: 'panificio', name: 'Panificio', parent_id: null, icon: null },
  { id: 'm-fio', slug: 'fiori', name: 'Fiori', parent_id: null, icon: null },
];

const negozio = (id: string, nome: string) => ({
  id, store_name: nome, store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null,
  store_logo: null, store_hours: null, store_media: null, is_approved: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
});

const righeCategorie: Riga[] = [
  { seller_id: 'a-vicino', categorie: ['m-pan'] },
  { seller_id: 'z-lontano', categorie: ['m-fio'] },
];

const stato = { erroreCategorie: false, errorePerNegozio: false };
const pg = creaPostgrestColTetto({
  categories: categorie,
  seller_public_profiles: [negozio('a-vicino', 'Forno Vicino'), negozio('z-lontano', 'Fiori Lontani')],
});

/** Un finto `rpc('categorie_per_negozio')`: si legge così com'è, e accetta ordine e finestra se la pagina li chiede. */
function rpcCategorie() {
  const q = {
    order() { return q; },
    range() { return q; },
    then<T>(risolvi: (v: { data: Riga[] | null; error: { message: string } | null }) => T, rifiuta?: (e: unknown) => unknown) {
      const esito = stato.errorePerNegozio
        ? { data: null, error: { message: 'servizio dati giù' } }
        : { data: righeCategorie, error: null };
      return Promise.resolve(esito).then(risolvi, rifiuta);
    },
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => {
      if (t === 'categories' && stato.erroreCategorie) {
        const q = {
          select: () => q, order: () => q, range: () => q,
          then: <T,>(r: (v: { data: null; error: { message: string } }) => T) =>
            Promise.resolve({ data: null, error: { message: 'servizio dati giù' } }).then(r),
        };
        return q;
      }
      return pg.client.from(t);
    },
    rpc: (nome: string) => {
      if (nome === 'categorie_per_negozio') return rpcCategorie();
      if (nome === 'store_cards') {
        return Promise.resolve({
          data: [{ seller_id: 'a-vicino', prodotti: [], totale: 3 }, { seller_id: 'z-lontano', prodotti: [], totale: 3 }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
  },
}));
vi.mock('@/components/StorePreviewCard', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: { store: { store_name: string } }) => ce('article', null, p.store.store_name) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import StoresPage from '@/app/stores/page';

async function montaLaPagina() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(StoresPage)));
  });
  for (let i = 0; i < 40 && !radice.textContent?.includes('Forno Vicino'); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
  return { radice, smonta: () => act(() => root.unmount()) };
}

beforeEach(() => {
  stato.erroreCategorie = false;
  stato.errorePerNegozio = false;
  document.body.innerHTML = '';
});

describe('R12-013 — se la lettura delle categorie cade, la pagina lo dice', () => {
  const avviso = (radice: HTMLElement) =>
    [...radice.querySelectorAll('[role="status"]')].find((n) => /settori/i.test(n.textContent ?? ''));

  it('controprova: con le categorie lette ci sono i filtri e nessun avviso', async () => {
    const { radice, smonta } = await montaLaPagina();
    expect(radice.textContent).toContain('Forno Vicino');
    const panificio = [...radice.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Panificio');
    expect(panificio, 'controprova: i filtri delle categorie si disegnano').toBeTruthy();
    await act(async () => { panificio!.click(); });
    expect(radice.textContent, 'controprova: il filtro trova il negozio del suo settore').toContain('Forno Vicino');
    expect(radice.textContent, 'controprova: il filtro toglie quello di un altro settore').not.toContain('Fiori Lontani');
    expect(avviso(radice)).toBeUndefined();
    smonta();
  }, 60000);

  it('le categorie non arrivano: i filtri non ci sono, ma un avviso visibile lo spiega', async () => {
    stato.erroreCategorie = true;
    const { radice, smonta } = await montaLaPagina();
    expect(radice.textContent, 'controprova: i negozi si vedono lo stesso').toContain('Forno Vicino');
    expect([...radice.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Panificio')).toBe(false);
    expect(avviso(radice), 'i filtri per settore sono spariti senza nessun avviso').toBeTruthy();
    smonta();
  }, 60000);

  it('le categorie dei negozi non arrivano: anche qui l\'avviso', async () => {
    stato.errorePerNegozio = true;
    const { radice, smonta } = await montaLaPagina();
    expect(radice.textContent, 'controprova: i negozi si vedono lo stesso').toContain('Forno Vicino');
    expect(avviso(radice), 'il filtro per settore non trova più i negozi e la pagina non lo dice').toBeTruthy();
    smonta();
  }, 60000);
});
