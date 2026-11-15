import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R20-013 — il carosello pagato porta l'etichetta «Sponsorizzato» (la parola dei termini),
 * non «Sponsored» in inglese, vicina al titolo e leggibile.
 */
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: async () => ({}) } }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => createElement('img', { alt }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [{ id: 'c1', product: { id: 'p1', name: 'Focaccia', price: 4, images: [], profiles: { store_name: 'Forno' } } }],
  }),
}));

const { default: Carosello } = await import('@/components/SponsoredCarousel');

describe('R20-013 · etichetta del carosello pagato', () => {
  const html = renderToStaticMarkup(createElement(Carosello, { placement: 'home_top' }));
  it('dice «Sponsorizzato» e non «Sponsored»', () => {
    expect(html).toContain('Sponsorizzato');
    expect(html).not.toMatch(/Sponsored/);
  });
  it('è leggibile (non 10 px grigio chiaro) e non è spinta in fondo alla riga', () => {
    expect(html).not.toContain('text-[10px]');
    expect(html).not.toContain('justify-between');
  });
});
