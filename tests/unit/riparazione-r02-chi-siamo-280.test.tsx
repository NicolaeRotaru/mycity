/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R02-004 (onda 9, giro 2) — A 280 PX COL TESTO AL 200% «CHI SIAMO» NON SCORRE PIÙ DI LATO.
 *
 * Misurato in Chromium (Playwright) su `next dev`, html{font-size:200%}, 280 px: prima 319 px.
 * Due cause, e servono tutte e due: (1) «Accedi» della barra mobile era shrink-0 e, con il logo,
 * non stava (295 px da sola); (2) nella pagina, le caselle dei numeri chiedono colonne da 8rem
 * (256 px) e il bottone «Apri un negozio» è più largo della banda finale. Dopo: 280 px, e a 300 e
 * 320 resta uguale. Le correzioni della pagina valgono solo fino a 300 px (max-[300px]:): sopra la
 * banda finale resta p-8 e i bottoni px-5 (a 375 px col testo normale misurati 32 e 20 px, come prima).
 * Qui la prova leggera sulle classi.
 */

vi.mock('@/lib/cms', () => ({ loadPublishedCmsPage: async () => null }));
vi.mock('@/components/cms/CmsPageView', () => ({ default: () => null }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: () => ({ select: async () => ({ count: 12 }) }) }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }), signOut: async () => ({}) },
    from: () => ({}),
  },
}));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: null, userEmail: null, isAuthenticated: false, isLoading: false, isSeller: false, isRider: false, isAdmin: false }),
}));
vi.mock('@/components/hooks/useCartCount', () => ({ useCartCount: () => 0 }));
vi.mock('@/components/hooks/useNotificationsCount', () => ({ useNotificationsCount: () => 0 }));
vi.mock('@/components/hooks/useMessagesUnread', () => ({ useMessagesUnread: () => 0 }));
vi.mock('@/components/hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('@/components/hooks/useBranding', () => ({ useBranding: () => ({ wordmark: { accent: 'My', rest: 'City' }, name: 'MyCity' }) }));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => 'buy', useCanPurchase: () => true }));
vi.mock('@/components/LocationPill', () => ({ default: () => null }));
vi.mock('@/components/PromoTicker', () => ({ default: () => null }));
vi.mock('@/components/SearchBar', () => ({ default: () => null }));
vi.mock('@/components/CategoryBar', () => ({ default: () => null }));
vi.mock('@/lib/account-menu', () => ({ getAccountMenuItems: () => [] }));
vi.mock('@/lib/analytics/events', () => ({ trackSignedOut: () => undefined }));
vi.mock('@/lib/push/dispositivo', () => ({ scollegaQuestoDispositivo: async () => undefined }));
vi.mock('@/lib/image-loader', () => ({ default: () => '' }));

import Navbar from '@/components/Navbar';
import AboutPage from '@/app/about/page';

const classi = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('R02-004 · «Chi siamo» a 280 px col testo al 200% non scorre di lato', () => {
  it('«Accedi» della barra mobile può stringersi e andare a capo', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => { root.render(createElement(Navbar)); });
    const mobile = radice.querySelector('div.md\\:hidden');
    const accedi = Array.from(mobile!.querySelectorAll('a')).find((a) => a.textContent === 'Accedi');
    expect(accedi, '«Accedi» della barra mobile c è').toBeTruthy();
    const c = classi(accedi);
    expect(c, 'shrink-0 la tiene larga quanto la parola: a 280 px la barra sfora').not.toContain('shrink-0');
    expect(c).toContain('min-w-0');
    expect(c).toContain('[overflow-wrap:anywhere]');
    expect(c).toContain('text-right');
    act(() => root.unmount());
  });

  it('la pagina cura solo sotto i 300 px: una colonna per i numeri e bottoni più stretti', async () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(await AboutPage()), 'text/html');
    const griglia = Array.from(doc.querySelectorAll('div')).find((d) => classi(d).some((x) => x.startsWith('grid-cols-[repeat(auto-fit')));
    expect(classi(griglia), 'i numeri restano a colonne da 8rem anche a 280 px').toContain('max-[300px]:grid-cols-1');
    for (const href of ['/lavora-con-noi', '/sell']) {
      const bottone = doc.querySelector(`a[href="${href}"]`);
      const c = classi(bottone);
      expect(c, `${href}: bottone più stretto sotto 300 px`).toContain('max-[300px]:px-3');
      expect(c).toContain('max-[300px]:max-w-full');
      expect(c, `${href}: sopra i 300 px il margine resta px-5`).toContain('px-5');
    }
  });

  it('la banda finale resta p-8 per tutti gli altri schermi (nessuna variante senza prefisso)', async () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(await AboutPage()), 'text/html');
    const banda = Array.from(doc.querySelectorAll('div')).find((d) => classi(d).includes('bg-ink-900') && classi(d).includes('rounded-2xl'));
    const c = classi(banda);
    expect(c).toContain('p-8');
    expect(c).toContain('md:p-11');
    expect(c.filter((x) => /^(px|py)-/.test(x)), 'nessun px-/py- senza prefisso sulla banda').toEqual([]);
  });
});
