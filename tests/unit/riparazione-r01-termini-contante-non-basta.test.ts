/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compensoDalContante } from '@/lib/shipping';

/**
 * 27/11/2026 — I TERMINI SUL CONTRASSEGNO NON DICEVANO COSA SUCCEDE QUANDO IL CONTANTE NON BASTA.
 *
 * Con il credito MyCity scalato dal totale, il contante alla consegna puo' essere meno del
 * compenso del Rider (o zero). Il codice gli fa trattenere il minimo fra compenso e contante e
 * gli versa il resto per bonifico (compensoDalContante → residuoDovutoCents in lib/shipping.ts).
 * Prova leggera: il codice fa davvero cosi', e i Termini veri lo dicono.
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

describe('i Termini dicono cosa succede quando il contante non copre il compenso del Rider', () => {
  it('il codice: trattiene il contante che ha, il resto del compenso resta dovuto per bonifico', () => {
    expect(compensoDalContante({ total_price: 2, rider_fee_cents: 300 })).toEqual({
      trattenutoCents: 200,
      residuoDovutoCents: 100,
    });
    expect(compensoDalContante({ total_price: 0, rider_fee_cents: 300 })).toEqual({
      trattenutoCents: 0,
      residuoDovutoCents: 300,
    });
  });

  it('il testo dice che il Rider trattiene solo il contante che riceve e il resto gli arriva con un bonifico', async () => {
    const p = await paragrafoDeiContanti();
    expect(p).toMatch(/meno del compenso del Rider/);
    expect(p).toMatch(/credito MyCity/);
    expect(p).toMatch(/trattiene solo il contante che riceve/);
    expect(p).toMatch(/gliela versa MyCity con un bonifico/);
  });
});
