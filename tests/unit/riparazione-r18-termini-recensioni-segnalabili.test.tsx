/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 26/11/2026 (R18-003) — I TERMINI DICONO DOVE SI SEGNALA UNA RECENSIONE.
 *
 * «Segnala questo contenuto» c'è sotto ogni recensione (scheda prodotto e vetrina), ma il §16-bis
 * nominava solo schede prodotto e pagine negozio. La prova disegna i Termini veri e legge la frase.
 */

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: true }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => {
    throw new Error('la prova non legge la banca dati');
  },
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock('next/image', () => ({ default: () => null }));

const testo = (h: string) =>
  h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('R18-003 · i Termini dicono che anche una recensione si segnala', () => {
  it('il §16-bis nomina le recensioni fra i posti dove c è «Segnala questo contenuto»', async () => {
    const { default: TermsPage } = await import('@/app/terms/page');
    const t = testo(renderToStaticMarkup(createElement(TermsPage as never)));
    const i = t.indexOf('16-bis.');
    expect(i, 'manca la sezione 16-bis').toBeGreaterThanOrEqual(0);
    const frase = t.slice(t.indexOf('Su ogni scheda prodotto', i), t.indexOf('«Segnala questo contenuto»', i));
    expect(frase).toMatch(/sotto ogni recensione/);
  });
});
