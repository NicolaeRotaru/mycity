import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 30/10/2026 — LA HOME E IL PIEDE NON TENGONO L'ABBIGLIAMENTO, NEMMENO COL DATABASE CADUTO.
 *
 * Nicola il 29/10 alle 00:05 (registro dei fatti, catalogo.categorie): al lancio niente
 * abbigliamento. L'ondata 15 aveva tolto la parola dal sottotitolo e dalla descrizione Google, ma
 * restava il bottone «Abbigliamento» sotto il titolo grande della home, e il piede lo elencava fra
 * le categorie di riserva: quelle che si vedono al primo disegno e quando la lettura cade.
 * Qui si disegnano tutti e due con la lettura caduta e si legge il testo e i link.
 */

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => {} }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));
vi.mock('@/components/home/HeroStoreCard', () => ({ default: () => null }));
vi.mock('@/components/home/HomeCtaLink', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));

const ABBIGLIAMENTO = /abbigliament|\bmoda\b|vestit/i;

describe('niente abbigliamento quando il database non risponde', () => {
  it('il titolo grande della home: i bottoni sotto il titolo non nominano l’abbigliamento', async () => {
    const { default: HomeSectionRenderer } = await import('@/components/home-sections/HomeSectionRenderer');
    const html = renderToStaticMarkup(
      createElement(HomeSectionRenderer, {
        sections: [{ id: 'eroe', type: 'hero', config: {} }] as never,
        heroVariant: 'a',
        heroDefaults: { eyebrow: 'x', headline: 'x', subhead: 'x', ctaPrimary: 'x' } as never,
      }),
    );
    expect(html, 'il bottone sotto il titolo deve esserci (la prova disegna davvero i bottoni)').toContain('/category/alimentari');
    expect(html).not.toMatch(ABBIGLIAMENTO);
  });

  it('il piede: le categorie di riserva non contengono l’abbigliamento', async () => {
    const { default: Footer } = await import('@/components/Footer');
    const html = renderToStaticMarkup(createElement(Footer));
    expect(html, 'la colonna delle categorie di riserva deve esserci').toContain('/category/alimentari');
    expect(html).not.toMatch(ABBIGLIAMENTO);
  });
});
