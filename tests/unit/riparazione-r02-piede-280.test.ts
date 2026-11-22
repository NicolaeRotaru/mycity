import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R02-005 (onda 9) — COL TESTO INGRANDITO AL MASSIMO SUL TELEFONO IL PIÈ DI PAGINA NON FA PIÙ
 * SCORRERE DI LATO LE PAGINE PUBBLICHE, NEANCHE A 280 PX.
 *
 * R15-008 aveva tolto le due colonne fisse: ogni colonna larga almeno 8rem. Ma 8rem col testo al
 * 200% sono 256 px, più i margini del piede (px-4 = 2 × 32 px) fanno 320: sullo schermo esterno
 * dei telefoni pieghevoli (280 px) ogni pagina pubblica scorreva ancora di 8 px, per colpa del piede.
 * Misurato in Chrome (Playwright) su `next dev`, html{font-size:200%}: il piede arrivava a 288 px
 * su /about, /faq, /stores, /categorie; dopo resta nei 280 (resta solo la barra in alto, non del
 * piede), e a 360 col testo normale le colonne restano due. Qui la prova leggera sulla classe che lo fa.
 */

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: true }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

describe('R02-005 · il piede non è mai più largo dello schermo, col testo al 200% a 280 px', () => {
  it('sotto md la colonna minima è min(100%, max(8rem, mezza riga)): mai più larga della riga', async () => {
    const { default: Footer } = await import('@/components/Footer');
    const html = renderToStaticMarkup(createElement(Footer));
    const griglia = (html.match(/<footer[^>]*>\s*<div class="([^"]+)"/)?.[1] ?? '').split(/\s+/);
    expect(griglia).toContain('grid');
    const colonne = griglia.filter((c) => c.startsWith('grid-cols-['));
    expect(colonne).toHaveLength(1);
    // Con max(8rem,…) da solo la colonna resta di 256 px anche dove la riga ne ha 216.
    expect(colonne[0]).toBe('grid-cols-[repeat(auto-fit,minmax(min(100%,max(8rem,calc((100%_-_2rem)/2))),1fr))]');
    // Da md in su, come prima.
    expect(griglia).toContain('md:grid-cols-5');
  });
});
