/**
 * @vitest-environment jsdom
 *
 * R11-001 — Nella pagina di una lista (/lists/[id]) il prezzo dei prodotti era quello pieno anche
 * con una promozione attiva del negozio: griglia, scheda prodotto e cassa applicano lo sconto, la
 * lista no. Chi apriva la lista leggeva 10 € e poi, nella scheda, pagava 8 €.
 *
 * Qui la pagina sta in un QueryClient vero sopra un database finto in memoria, con la funzione degli
 * sconti attivi (`product_active_discounts`) che risponde come quella vera. Si guarda il prezzo che
 * esce a video per un prodotto in promo e per uno senza.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatPrice } from '@/lib/format';

const db = vi.hoisted(() => ({
  liste: [] as Array<Record<string, unknown>>,
  righe: [] as Array<Record<string, unknown>>,
  sconti: {} as Record<string, number>,
  scontiRotti: false,
}));

vi.mock('@/lib/supabase/client', () => {
  function domanda(tabella: string) {
    const filtri: Array<[string, unknown]> = [];
    let una = false;
    const passa = (r: Record<string, unknown>) => filtri.every(([k, v]) => r[k] === v);
    const esegui = () => {
      const righe = tabella === 'product_list_items' ? db.righe : db.liste;
      const scelte = righe.filter(passa);
      return { data: una ? (scelte[0] ?? null) : scelte, error: null };
    };
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.limit = () => c;
    c.eq = (k: string, v: unknown) => { filtri.push([k, v]); return c; };
    c.maybeSingle = () => { una = true; return c; };
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko);
    return c;
  }
  const rpc = async (nome: string, argomenti: { p_products?: string[]; p_product?: string }) => {
    if (db.scontiRotti) return { data: null, error: { message: 'funzione non raggiungibile' } };
    if (nome === 'product_active_discounts') {
      return { data: (argomenti.p_products ?? []).map((id) => ({ product_id: id, discount_percent: db.sconti[id] ?? 0 })), error: null };
    }
    if (nome === 'product_active_discount') return { data: db.sconti[argomenti.p_product ?? ''] ?? 0, error: null };
    return { data: null, error: { message: `rpc non prevista: ${nome}` } };
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-maria' } } }) },
      from: (t: string) => domanda(t),
      rpc,
    },
  };
});
vi.mock('@/lib/queries/profili-pubblici', () => ({
  conAutoriPubblici: async (liste: Array<Record<string, unknown>>) => liste.map((l) => ({ ...l, owner: null })),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// React 18 non ha ancora `use`: la pagina lo usa per i parametri, che qui arrivano già pronti.
vi.mock('react', async (originale) => ({ ...(await originale<Record<string, unknown>>()), use: (v: unknown) => v }));
vi.mock('next/link', () => import('./aiuti/finti/next-link.mjs'));
vi.mock('next/image', () => import('./aiuti/finti/next-image.mjs'));
vi.mock('next/navigation', () => import('./aiuti/finti/next-navigation.mjs'));
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));

import ListDetailPage from '@/app/lists/[id]/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLAZIONE = {
  id: 'L1', owner_id: 'u-amica', title: 'Colazione', description: null, cover_emoji: null,
  is_public: true, is_featured: false, updated_at: '2026-11-01T10:00:00Z',
};
const prodotto = (id: string, name: string, price: number | string) =>
  ({ list_id: 'L1', product_id: id, sort_order: 0, note: null, product: { id, name, price, images: null, status: 'available' } });

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  db.scontiRotti = false;
  document.body.innerHTML = '';
});

const spazi = (s: string) => s.replace(/\s/g, ' ');

/** Apre la lista e restituisce, per nome del prodotto, il testo della riga del prezzo. */
async function prezziDellaLista(): Promise<Record<string, string>> {
  const box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(ListDetailPage as never, { params: { id: 'L1' } })));
  });
  // Le righe dei prodotti (il percorso in cima è anche lui fatto di <li>).
  const righeProdotto = () => Array.from(box.querySelectorAll('li')).filter((li) => li.querySelector('a[href^="/product/"]'));
  await vi.waitFor(() => { expect(righeProdotto().length, 'la lista non mostra i prodotti').toBe(db.righe.length); }, { timeout: 3000, interval: 10 });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const esito: Record<string, string> = {};
  for (const li of righeProdotto()) {
    const righe = Array.from(li.querySelectorAll('a p'));
    const nome = righe[0]?.textContent ?? '';
    esito[nome] = spazi(righe[1]?.textContent ?? '');
  }
  return esito;
}

describe('R11-001 · la lista mostra il prezzo che si paga, con la promozione', () => {
  it('un prodotto in promo al 20% si legge a 8 €, non a 10 €; uno senza promo resta al suo prezzo', async () => {
    db.liste = [{ ...COLAZIONE }];
    db.righe = [prodotto('p-focaccia', 'Focaccia', '10.00'), prodotto('p-pane', 'Pane', 3)];
    db.sconti = { 'p-focaccia': 20 };
    const prezzi = await prezziDellaLista();
    // Il primo prezzo della riga è quello che si paga.
    expect(prezzi.Focaccia.startsWith(spazi(formatPrice(8))), `la lista scrive «${prezzi.Focaccia}» per la focaccia in promo`).toBe(true);
    // Il pieno, se c'è, è solo barrato accanto: mai come prezzo da pagare.
    expect(prezzi.Focaccia).not.toMatch(new RegExp(`^${spazi(formatPrice(10)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(prezzi.Pane).toBe(spazi(formatPrice(3)));
  });

  it('lo sconto si calcola al centesimo come la cassa: 1,15 € al -10% è 1,03 €, come in cassa', async () => {
    db.liste = [{ ...COLAZIONE }];
    db.righe = [prodotto('p-brioche', 'Brioche', 1.15)];
    db.sconti = { 'p-brioche': 10 };
    const prezzi = await prezziDellaLista();
    expect(prezzi.Brioche.startsWith(spazi(formatPrice(1.03))), `la lista scrive «${prezzi.Brioche}»`).toBe(true);
  });

  it('se lo sconto non si legge la lista si vede lo stesso, a prezzo pieno', async () => {
    db.liste = [{ ...COLAZIONE }];
    db.righe = [prodotto('p-focaccia', 'Focaccia', 10)];
    db.sconti = { 'p-focaccia': 20 };
    db.scontiRotti = true;
    const prezzi = await prezziDellaLista();
    expect(prezzi.Focaccia).toBe(spazi(formatPrice(10)));
  });
});
