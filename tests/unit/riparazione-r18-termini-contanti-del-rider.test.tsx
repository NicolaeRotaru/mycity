/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compensoDalContante, contanteDaRimettereCents } from '@/lib/shipping';

/**
 * 26/11/2026 — I TERMINI DICEVANO CHE IL FATTORINO CONSEGNA I CONTANTI A MYCITY.
 *
 * Nel contrassegno il fattorino non riceve un bonifico per la consegna: si tiene il suo compenso
 * dal contante che ha in mano e versa a MyCity il resto (compensoDalContante in lib/shipping.ts).
 * Il §5 diceva «li riceve il Rider alla consegna e li consegna a MyCity», come se versasse tutto.
 * La prova disegna i Termini veri e legge il paragrafo sui contanti.
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
  vi.resetModules();
});

async function paragrafoDeiContanti(): Promise<string> {
  const { default: TermsPage } = await import('@/app/terms/page');
  const t = testo(renderToStaticMarkup(createElement(TermsPage as never)));
  const i = t.indexOf('I contanti li riceve il Rider');
  expect(i, 'i Termini devono dire chi riceve i contanti').toBeGreaterThanOrEqual(0);
  return t.slice(i, t.indexOf('ogni lunedì', i));
}

describe('i Termini dicono dove vanno i contanti della consegna', () => {
  it('il codice: dal contante il fattorino si tiene il compenso e rimette solo il resto', () => {
    const ordine = { total_price: 19, rider_fee_cents: 300, pickup_in_store: false };
    expect(compensoDalContante(ordine).trattenutoCents).toBe(300);
    expect(contanteDaRimettereCents(ordine)).toBe(1600);
  });

  it('IL CASO CHE ROMPEVA — il testo non dice che il Rider consegna i contanti a MyCity', async () => {
    const p = await paragrafoDeiContanti();
    expect(p).not.toMatch(/alla consegna e li consegna a MyCity/);
  });

  it('il testo dice che il Rider trattiene il suo compenso e consegna il resto a MyCity', async () => {
    const p = await paragrafoDeiContanti();
    expect(p).toMatch(/trattiene il proprio compenso per la consegna/);
    expect(p).toMatch(/consegna il resto a MyCity/);
  });
});
