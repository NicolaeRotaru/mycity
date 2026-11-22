import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const profilo = { isSeller: false, isRider: false, isAuthenticated: false };
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: true }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => profilo }));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

// renderToStaticMarkup scrive > e & degli attributi come entità.
const decodifica = (t: string) => t.replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const rendi = async () => {
  const { default: Footer } = await import('@/components/Footer');
  return renderToStaticMarkup(createElement(Footer));
};

describe('R12-010 · il piede non salta dall\'h1 all\'h3', () => {
  it('il primo titolo del piede è un h2 (nascosto) e viene prima di ogni h3', async () => {
    const html = await rendi();
    const titoli = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    expect(titoli.length).toBeGreaterThan(1);
    expect(titoli[0]).toBe(2);
    expect(titoli.slice(1).every((l) => l === 3)).toBe(true);
  });

  it('l\'h2 è sr-only: l\'aspetto del piede non cambia', async () => {
    const html = await rendi();
    expect(html).toMatch(/<h2 class="sr-only">[^<]+<\/h2>/);
  });
});

describe('R12-006 · col testo grande le voci lunghe del piede vanno a capo dentro la loro colonna', () => {
  it('la griglia tiene md:grid-cols-5, rende le colonne comprimibili (min-w-0) e fa andare a capo titoli, link e paragrafi con overflow-wrap:anywhere (che riduce anche la larghezza minima: i link inline-flex non sbordano)', async () => {
    const html = await rendi();
    const griglia = decodifica(html.match(/<footer[^>]*>\s*<div class="([^"]+)"/)?.[1] ?? '').split(/\s+/);
    expect(griglia).toContain('md:grid-cols-5');
    expect(griglia).toContain('[&>div]:min-w-0');
    expect(griglia).toContain('[&_h3]:[overflow-wrap:anywhere]');
    expect(griglia).toContain('[&_a]:[overflow-wrap:anywhere]');
    expect(griglia).toContain('[&_p]:[overflow-wrap:anywhere]');
  });

  it('nell\'area venditore restano quattro colonne, comprimibili e con le voci a capo', async () => {
    Object.assign(profilo, { isSeller: true });
    try {
      const html = await rendi();
      const griglia = decodifica(html.match(/<footer[^>]*>\s*<div class="([^"]+)"/)?.[1] ?? '').split(/\s+/);
      expect(griglia).toContain('md:grid-cols-4');
      expect(griglia).toContain('[&>div]:min-w-0');
      expect(griglia).toContain('[&_a]:[overflow-wrap:anywhere]');
    } finally {
      Object.assign(profilo, { isSeller: false });
    }
  });
});
