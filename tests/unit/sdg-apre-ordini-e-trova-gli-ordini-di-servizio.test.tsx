/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';
import { queryKeys } from '@/lib/queries/keys';

/**
 * 28/11/2026 — SDG AGENZIA APRIVA «ORDINI» E NON TROVAVA I SUOI ORDINI.
 *
 * Nicola, alle 00:36 e alle 00:51: entrato come SDG Agenzia, «Ordini» diceva «Nessun ordine», e alle
 * 00:34 era nato un ordine di servizio vero (tabella `ordini_sdg`). Gli ordini di SDG non sono ordini
 * dei prodotti.
 *
 *  · per l'account di SDG la voce del menu porta a /seller/ordini-sdg e si chiama «Ordini di servizio»,
 *    senza il pallino che conta gli ordini dei prodotti, ed è accesa anche su /seller/orders;
 *  · per SDG la pagina /seller/orders mostra l'elenco degli ordini di servizio, così ci arrivano tutti
 *    gli ingressi a «Ordini» (dashboard, testata, menu dell'account, barra in basso);
 *  · per SDG nessuno legge la tabella `orders`: né il pallino del menu, né la pagina;
 *  · per ogni altro negozio menu e pagina restano quelli di prima.
 */

type Lettura = { queryKey: readonly unknown[]; enabled?: boolean; queryFn?: (ctx: { pageParam: number }) => unknown };

const stato = vi.hoisted(() => ({
  id: 's-1',
  pathname: '/seller/dashboard',
  letture: [] as Array<{ queryKey: readonly unknown[]; enabled?: boolean; queryFn?: (ctx: { pageParam: number }) => unknown }>,
  tabelle: [] as string[],
  // Un ordine di servizio come lo restituisce /api/sdg/ordini.
  ordineSdg: {
    id: 'ordine-sdg-1', seller_id: 'negozio-1', nome_attivita: 'Caffè di Piacenza',
    dati_attivita: { indirizzo: 'Via Roma 1', citta: 'Piacenza' }, fascia: 'business',
    canone_centesimi: 9900, primo_mese_centesimi: null, visita_il: null, agente_email: null, lavoro: null,
    accettato_il: '2026-11-27T23:34:00.000Z', piano: { contenuti: [], note: [] }, piano_origine: 'sito',
    piano_completo_stato: 'da_collegare', lavoro_piano: null, piano_completo_errore: null, piano_completo_il: null,
    creato_il: '2026-11-27T23:34:00.000Z', aggiornato_il: '2026-11-27T23:34:00.000Z', visita: 'Visita: da fissare',
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => stato.pathname,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  // Ogni lettura chiesta si annota. Gli ordini di servizio ne hanno uno; tre ordini dei prodotti
  // «da fare» per chi li conta; un conteggio spento non dà niente.
  useQuery: (o: Lettura) => {
    stato.letture.push(o);
    if (o.queryKey[0] === 'sdg') return { data: [stato.ordineSdg], isLoading: false, error: null };
    return { data: o.enabled === false ? undefined : o.queryKey.includes('todo-count') ? 3 : o.queryKey.includes('list') ? [] : 0 };
  },
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
  // La lista degli ordini dei prodotti: una lettura riuscita, senza ordini.
  useInfiniteQuery: (o: Lettura) => {
    stato.letture.push(o);
    return {
      data: { pages: [[]] }, isPending: false, isLoading: false, isError: false, error: null,
      dataUpdatedAt: Date.now(), errorUpdatedAt: 0, refetch: () => undefined, hasNextPage: false,
    };
  },
}));
vi.mock('@/lib/supabase/client', () => {
  // Ogni tabella aperta si annota; la risposta è sempre vuota.
  const domanda = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'range', 'limit']) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(ok, ko);
    return b;
  };
  return {
    supabase: {
      auth: { signOut: async () => ({}), getUser: async () => ({ data: { user: { id: stato.id } } }) },
      from: (tabella: string) => { stato.tabelle.push(tabella); return domanda(); },
    },
  };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: stato.id, role: 'seller', store_name: stato.id === 's-1' ? 'Forno' : 'SDG Agenzia' },
    userEmail: 'x@x.it', isAuthenticated: true, isSeller: true, isLoading: false,
  }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));
window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never;

const { default: SellerShell } = await import('@/components/seller/SellerShell');
const { default: SellerOrdersPage } = await import('@/app/seller/orders/page');

const accesi: Root[] = [];
async function montaIlMenu() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  accesi.push(root);
  await act(async () => { root.render(createElement(SellerShell, null, createElement('p', null, 'contenuto'))); });
  return div.querySelector('aside[aria-label="Menu venditore"]')!;
}
const voce = (menu: Element, href: string) => menu.querySelector(`nav a[href="${href}"]`);

/**
 * Le tabelle che aprono davvero le letture degli ordini rimaste accese (la famiglia
 * `queryKeys.seller.orders`: il pallino del menu e la lista della pagina), fatte partire come
 * farebbe React Query. Una lettura spenta (`enabled: false`) non parte.
 */
async function tabelleLetteDagliOrdini(): Promise<string[]> {
  const famiglia = JSON.stringify(queryKeys.seller.orders).slice(0, -1);
  for (const o of stato.letture) {
    if (o.enabled === false || !JSON.stringify(o.queryKey).startsWith(famiglia)) continue;
    await o.queryFn?.({ pageParam: 0 });
  }
  return stato.tabelle;
}

beforeEach(() => {
  stato.id = 's-1';
  stato.pathname = '/seller/dashboard';
  stato.letture.length = 0;
  stato.tabelle.length = 0;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('la voce «Ordini» del menu del venditore', () => {
  it('per SDG Agenzia porta agli ordini di servizio, senza il pallino e senza leggere gli ordini dei prodotti', async () => {
    stato.id = SDG_SELLER_ID;
    const menu = await montaIlMenu();
    const ordiniDiServizio = voce(menu, '/seller/ordini-sdg');
    expect(ordiniDiServizio).not.toBeNull();
    expect(ordiniDiServizio!.textContent).toBe('Ordini di servizio');
    expect(voce(menu, '/seller/orders')).toBeNull();
    expect(menu.textContent).not.toContain('ordini da gestire');
    expect(await tabelleLetteDagliOrdini()).not.toContain('orders');
  });

  it('per SDG Agenzia resta accesa anche su /seller/orders', async () => {
    stato.id = SDG_SELLER_ID;
    stato.pathname = '/seller/orders';
    const menu = await montaIlMenu();
    expect(voce(menu, '/seller/ordini-sdg')!.getAttribute('aria-current')).toBe('page');
  });

  it('per un altro negozio porta ancora agli ordini dei prodotti, col suo pallino', async () => {
    stato.pathname = '/seller/orders';
    const menu = await montaIlMenu();
    const ordini = voce(menu, '/seller/orders');
    expect(ordini).not.toBeNull();
    expect(ordini!.textContent).toContain('Ordini');
    expect(ordini!.textContent).toContain('3 ordini da gestire');
    expect(ordini!.getAttribute('aria-current')).toBe('page');
    expect(voce(menu, '/seller/ordini-sdg')).toBeNull();
    // La prova sa vedere una lettura: per il negozio normale il pallino legge `orders`.
    expect(await tabelleLetteDagliOrdini()).toContain('orders');
  });
});

describe('la pagina /seller/orders', () => {
  it('a SDG Agenzia mostra gli ordini di servizio, non la lista vuota dei prodotti', () => {
    stato.id = SDG_SELLER_ID;
    const html = renderToStaticMarkup(createElement(SellerOrdersPage));
    expect(html).toContain('Ordini di servizio di SDG');
    expect(html).toContain('Caffè di Piacenza');
    expect(html).not.toContain('Ordini ricevuti');
    expect(html).not.toContain('Nessun ordine');
    expect(html).not.toContain('Non hai ancora ricevuto ordini');
  });

  it('per SDG Agenzia non legge la tabella degli ordini dei prodotti', async () => {
    stato.id = SDG_SELLER_ID;
    renderToStaticMarkup(createElement(SellerOrdersPage));
    expect(await tabelleLetteDagliOrdini()).not.toContain('orders');
  });

  it('a un altro negozio mostra la pagina di prima, che legge i suoi ordini', async () => {
    const html = renderToStaticMarkup(createElement(SellerOrdersPage));
    expect(html).toContain('Ordini ricevuti');
    expect(html).toContain('Nessun ordine');
    expect(html).not.toContain('Ordini di servizio di SDG');
    expect(await tabelleLetteDagliOrdini()).toContain('orders');
  });
});
