import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R12-006 — Sul tablet col testo al 200% «Dichiarazione accessibilità» usciva dal piede e la pagina
 * scorreva di lato: da md in su le colonne erano cinque FISSE (md:grid-cols-5, quattro nell'area
 * venditore). Ora ogni colonna è larga almeno 6rem (cresce col testo), mai più della riga, e quelle
 * che non ci stanno vanno a capo. Misurato in Chrome: a 768 px col testo normale restano cinque
 * colonne da 118 px (come prima), a 200% diventano due.
 */

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

const rendi = async () => {
  const { default: Footer } = await import('@/components/Footer');
  return renderToStaticMarkup(createElement(Footer));
};

describe('R12-006 · il piede da md in su non ha colonne fisse', () => {
  it('la griglia da md non è md:grid-cols-5 né md:grid-cols-4: le colonne hanno una larghezza minima che cresce col testo', async () => {
    const html = await rendi();
    const griglia = (html.match(/<footer[^>]*>\s*<div class="([^"]+)"/)?.[1] ?? '').split(/\s+/);
    expect(griglia).not.toContain('md:grid-cols-5');
    expect(griglia).not.toContain('md:grid-cols-4');
    expect(griglia).toContain('md:grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))]');
  });

  it('anche nell\'area venditore (quattro colonne) non ci sono colonne fisse', async () => {
    Object.assign(profilo, { isSeller: true });
    try {
      const html = await rendi();
      const griglia = (html.match(/<footer[^>]*>\s*<div class="([^"]+)"/)?.[1] ?? '').split(/\s+/);
      expect(griglia).not.toContain('md:grid-cols-4');
      expect(griglia).toContain('md:grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))]');
    } finally {
      Object.assign(profilo, { isSeller: false });
    }
  });
});

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
