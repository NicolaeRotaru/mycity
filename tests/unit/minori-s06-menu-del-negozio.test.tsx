/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';

/**
 * S06 — Il guscio del pannello negozio.
 * 233:  sul telefono il menu chiuso è inert (fuori da Tab e lettore di schermo); aperto, Esc lo chiude.
 * 1565: il campanello delle notifiche non blocca lo scorrimento della pagina.
 * 382:  il menu è alto quanto lo schermo vero (dvh) e il piede rispetta la zona sicura.
 * 361:  la ricerca dice cosa cerca, e la pagina Prodotti filtra per nome.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 0 }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Forno' }, userEmail: 'f@f.it', isAuthenticated: true, isSeller: true }),
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never;

const { default: SellerShell } = await import('@/components/seller/SellerShell');

async function monta() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(createElement(SellerShell, null, createElement('p', null, 'contenuto'))); });
  return { div, root };
}
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

describe('233 — il cassetto del menu sul telefono', () => {
  it('chiuso è inert, aperto no, e Esc lo richiude', async () => {
    const { div, root } = await monta();
    const menu = div.querySelector('aside[aria-label="Menu venditore"]')!;
    expect(menu.hasAttribute('inert')).toBe(true);
    await clic(div.querySelector('button[aria-label="Apri menu"]')!);
    expect(menu.hasAttribute('inert')).toBe(false);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(menu.hasAttribute('inert')).toBe(true);
    act(() => root.unmount());
  });
});

describe('1565 — il campanello', () => {
  it('aprire le notifiche non blocca lo scorrimento', async () => {
    const { div, root } = await monta();
    await clic(div.querySelector('button[aria-label="Notifiche"]')!);
    expect(div.querySelector('#pannello-notifiche-venditore')).not.toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    act(() => root.unmount());
  });
});

describe('382 · 361 — misure e ricerca', () => {
  const s = readFileSync('components/seller/SellerShell.tsx', 'utf8');
  it('dvh sul telefono e pb-safe al piede', () => {
    expect(s).toContain('h-dvh lg:h-screen');
    expect(s).toContain('p-3 pb-safe');
  });
  it('la ricerca dice che cerca fra i prodotti, e la pagina Prodotti legge q', () => {
    expect(s).toContain('placeholder="Cerca fra i tuoi prodotti…"');
    const p = readFileSync('app/seller/products/page.tsx', 'utf8');
    expect(p).toContain("if (ricerca) domanda = domanda.ilike('name', perIlike(ricerca));");
    expect(p).toContain("parametri?.get('q')");
  });
});
