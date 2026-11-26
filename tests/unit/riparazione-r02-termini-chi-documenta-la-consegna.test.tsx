/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 26/11/2026 — I TERMINI MANDAVANO A CHIEDERE AL NEGOZIO LA FATTURA ANCHE DELLA CONSEGNA.
 *
 * La consegna («Consegna MyCity») la incassa MyCity, non il negozio. Il §5 diceva che ogni
 * documento fiscale «relativo alla vendita» è del Venditore e che chi vuole una fattura la chiede
 * al Venditore: per la parte della consegna il negozio non la può fare, perché quei soldi non
 * sono suoi. La prova disegna i Termini veri e legge il paragrafo «Documenti fiscali».
 * Non chiede un documento per la consegna: quello oggi non nasce ed è una scelta di Nicola.
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function paragrafoFiscale(): Promise<string> {
  vi.resetModules();
  const { default: TermsPage } = await import('@/app/terms/page');
  const t = testo(renderToStaticMarkup(createElement(TermsPage as never)));
  const i = t.indexOf('Documenti fiscali');
  expect(i, 'i Termini devono avere il paragrafo «Documenti fiscali»').toBeGreaterThanOrEqual(0);
  return t.slice(i, t.indexOf('6. Consegne', i));
}

describe('i Termini dicono chi incassa la consegna', () => {
  it('la fattura dal Venditore riguarda i prodotti, non tutto l’ordine', async () => {
    const p = await paragrafoFiscale();
    expect(p).toMatch(/fattura per i prodotti deve richiederla direttamente al Venditore/);
    expect(p).not.toMatch(/necessiti di una fattura deve richiederla/);
  });

  it('le spese di consegna sono di MyCity e non si chiedono al Venditore', async () => {
    const p = await paragrafoFiscale();
    expect(p).toMatch(/spese di consegna invece le incassa MyCity, non il Venditore/);
    expect(p).toMatch(/Per le spese di consegna rivolgiti a MyCity/);
  });

  it('e non promette un documento fiscale per la consegna che oggi non esiste', async () => {
    const p = await paragrafoFiscale();
    expect(p).not.toMatch(/MyCity (emette|rilascia|invia) (la |una )?(fattura|ricevuta|documento)/i);
  });
});
