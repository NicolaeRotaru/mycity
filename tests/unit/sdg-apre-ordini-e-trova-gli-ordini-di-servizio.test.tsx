/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';

/**
 * 28/11/2026 — SDG AGENZIA APRIVA «ORDINI» E LEGGEVA «NESSUN ORDINE».
 *
 * Nicola, alle 00:36: entrato come SDG Agenzia, la voce «Ordini» del menu portava agli ordini dei
 * prodotti, e SDG non ne ha: alle 00:34 era nato un ordine di servizio vero (tabella `ordini_sdg`),
 * che si legge solo in /seller/ordini-sdg. Il menu non portava lì.
 *
 *  · per l'account di SDG la voce porta a /seller/ordini-sdg e si chiama «Ordini di servizio»,
 *    senza il pallino che conta gli ordini dei prodotti;
 *  · per ogni altro negozio porta ancora a /seller/orders e si chiama «Ordini», col suo pallino;
 *  · chi è SDG e apre /seller/orders da un link vecchio trova in cima la strada per gli ordini di servizio.
 */

const stato = vi.hoisted(() => ({ id: 's-1' }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  // Tre ordini dei prodotti «da fare» per chi li conta; un conteggio spento non dà niente.
  useQuery: (o: { queryKey: readonly unknown[]; enabled?: boolean }) => ({
    data: o.enabled === false ? undefined : o.queryKey.includes('todo-count') ? 3 : o.queryKey.includes('list') ? [] : 0,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
  // La pagina Ordini: una lettura riuscita, senza ordini dei prodotti.
  useInfiniteQuery: () => ({
    data: { pages: [[]] }, isPending: false, isLoading: false, isError: false, error: null,
    dataUpdatedAt: Date.now(), errorUpdatedAt: 0, refetch: () => undefined, hasNextPage: false,
  }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: stato.id, role: 'seller', store_name: stato.id === 's-1' ? 'Forno' : 'SDG Agenzia' },
    userEmail: 'x@x.it', isAuthenticated: true, isSeller: true,
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

beforeEach(() => { stato.id = 's-1'; });
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('la voce «Ordini» del menu del venditore', () => {
  it('per SDG Agenzia porta agli ordini di servizio, senza il pallino degli ordini dei prodotti', async () => {
    stato.id = SDG_SELLER_ID;
    const menu = await montaIlMenu();
    const ordiniDiServizio = voce(menu, '/seller/ordini-sdg');
    expect(ordiniDiServizio).not.toBeNull();
    expect(ordiniDiServizio!.textContent).toBe('Ordini di servizio');
    expect(voce(menu, '/seller/orders')).toBeNull();
    expect(menu.textContent).not.toContain('ordini da gestire');
  });

  it('per un altro negozio porta ancora agli ordini dei prodotti, col suo pallino', async () => {
    const menu = await montaIlMenu();
    const ordini = voce(menu, '/seller/orders');
    expect(ordini).not.toBeNull();
    expect(ordini!.textContent).toContain('Ordini');
    expect(ordini!.textContent).toContain('3 ordini da gestire');
    expect(voce(menu, '/seller/ordini-sdg')).toBeNull();
  });
});

describe('la pagina /seller/orders', () => {
  it('a SDG Agenzia mostra in cima la strada per gli ordini di servizio', () => {
    stato.id = SDG_SELLER_ID;
    const html = renderToStaticMarkup(createElement(SellerOrdersPage));
    const strada = html.indexOf('href="/seller/ordini-sdg"');
    expect(strada).toBeGreaterThan(-1);
    expect(html).toContain('Vai agli ordini di servizio');
    // In cima: prima del titolo della pagina e del «Nessun ordine» dei prodotti.
    expect(strada).toBeLessThan(html.indexOf('Ordini ricevuti'));
    expect(strada).toBeLessThan(html.indexOf('Nessun ordine'));
  });

  it('a un altro negozio non la mostra', () => {
    const html = renderToStaticMarkup(createElement(SellerOrdersPage));
    expect(html).not.toContain('/seller/ordini-sdg');
    expect(html).toContain('Nessun ordine');
  });
});
