/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 28/11/2026 — IL RIQUADRO COL NOME E L'ABBONAMENTO IN OGNI PROFILO DEI NEGOZI.
 *
 * Nicola, dal telefono: in fondo al menu di Pane Quotidiano c'è il riquadro col nome e l'abbonamento,
 * che si apre al clic; «vorrei che fosse così dentro tutti i profili dei venditori». Il 28/11 sette
 * negozi su dieci aspettavano l'approvazione e vedevano una pagina senza menu né riquadro.
 *
 * Qui si monta il guscio vero nei due menu ridotti: il riquadro c'è sempre e si apre; le voci sono
 * solo quelle che il negozio in attesa può aprire, e niente porta agli ordini o al Profilo.
 * Sul codice di prima la proprietà `menu` non esisteva: il guscio dava a tutti il menu intero.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, prefetch: _p, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  // Una lettura spenta (`enabled: false`) non ha dati, come nel react-query vero.
  useQuery: (o: { queryKey: unknown[]; enabled?: boolean }) => ({
    data: o.enabled === false ? undefined
      : o.queryKey.includes('list') ? []
      : o.queryKey.includes('preventivo-agenzia') ? { attivo: { fascia: 'business', stato: 'active', rinnovoIl: null } }
      : 0,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-9', role: 'seller', store_name: 'Movida Cafè' }, userEmail: 'm@m.it', isAuthenticated: true, isSeller: true }),
}));
vi.mock('@/components/account/CambiaAccount', () => ({ default: () => null }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never;

const { default: SellerShell } = await import('@/components/seller/SellerShell');

async function monta(menu?: string) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(createElement(SellerShell as never, { menu } as never, createElement('p', null, 'contenuto'))); });
  return { div, root };
}
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const vociDelMenu = (div: HTMLElement) => Array.from(div.querySelectorAll('aside nav a')).map((a) => a.getAttribute('href'));

describe('il negozio in verifica', () => {
  it('ha il riquadro col nome e il piano, che si apre, e il menu con le sole pagine che può aprire', async () => {
    const { div, root } = await monta('in_verifica');
    const riquadro = div.querySelector('button[aria-controls="menu-account-venditore"]')!;
    expect(riquadro, 'il riquadro dell account non c è').toBeTruthy();
    expect(riquadro.textContent).toContain('Movida Cafè');
    expect(riquadro.textContent).toContain('Piano Business');
    await clic(riquadro);
    const menu = div.querySelector('#menu-account-venditore')!;
    expect(menu, 'il riquadro non si apre').toBeTruthy();
    expect(menu.querySelector('a[href="/seller/abbonamento"]')).toBeTruthy();
    expect(menu.querySelector('a[href="/seller/profile"]'), 'il Profilo si apre solo da approvato').toBeNull();
    const voci = vociDelMenu(div);
    expect(voci).toContain('/seller/dashboard');
    expect(voci).toContain('/seller/products');
    expect(voci.some((h) => h?.startsWith('/seller/servizi/'))).toBe(true);
    expect(voci).not.toContain('/seller/orders');
    expect(voci).not.toContain('/seller/promotions');
    act(() => root.unmount());
  });
});

describe('il negozio che non ha ancora mandato la richiesta (o sospeso, o rifiutato)', () => {
  it('ha il riquadro e la campanella, nessuna voce e nessuna ricerca dei prodotti', async () => {
    const { div, root } = await monta('solo_account');
    expect(div.querySelector('button[aria-controls="menu-account-venditore"]')).toBeTruthy();
    expect(div.querySelector('button[aria-label="Notifiche"]')).toBeTruthy();
    expect(vociDelMenu(div)).toEqual([]);
    expect(div.querySelector('form[role="search"]')).toBeNull();
    expect(div.querySelector('a[href="/seller/products/new"]')).toBeNull();
    // Dal collaudo del 28/11: la pagina Abbonamento per lui è un vicolo cieco (il layout ridisegna la sua schermata),
    // e il server gli rifiuta la lettura del piano. Il riquadro si apre, senza quella voce e senza la lettura.
    const riquadro = div.querySelector('button[aria-controls="menu-account-venditore"]')!;
    expect(riquadro.textContent).toContain('Venditore');
    await clic(riquadro);
    const menu = div.querySelector('#menu-account-venditore')!;
    expect(menu, 'il riquadro non si apre').toBeTruthy();
    expect(menu.querySelector('a[href="/seller/abbonamento"]')).toBeNull();
    expect(menu.textContent).toContain('Esci');
    act(() => root.unmount());
  });
});

describe('il negozio approvato', () => {
  it('ha il menu intero, come sempre', async () => {
    const { div, root } = await monta();
    const voci = vociDelMenu(div);
    expect(voci).toContain('/seller/orders');
    expect(voci).toContain('/seller/profile');
    expect(div.querySelector('form[role="search"]')).toBeTruthy();
    act(() => root.unmount());
  });
});
