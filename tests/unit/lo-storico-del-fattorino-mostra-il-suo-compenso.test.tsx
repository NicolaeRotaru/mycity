// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 1/11/2026 — LO STORICO CONSEGNE DEL FATTORINO MOSTRA IL SUO COMPENSO, NON LA SPEDIZIONE DEL CLIENTE.
 *
 * La pagina sommava `shipping_cost`, cioè quanto ha pagato il cliente per la spedizione.
 * Sopra i 30 € di spesa la spedizione è gratis: la consegna compariva a «+0,00 €» anche se il
 * fattorino aveva guadagnato 3 €. La regola giusta è `compensoConsegnaEuro` (lib/shipping.ts),
 * la stessa della pagina Guadagni e del bonifico.
 */

type Riga = Record<string, unknown>;
let righe: Riga[] = [];
let colonneLette = '';
let queryFn: (() => Promise<unknown>) | null = null;

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'rider-1' } } }) },
    from: () => ({
      select: (c: string) => {
        colonneLette = c;
        const catena = { eq: () => catena, order: async () => ({ data: righe, error: null }) };
        return catena;
      },
    }),
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryFn: () => Promise<unknown> }) => {
    queryFn = o.queryFn;
    return { data: righe, isLoading: false };
  },
}));

const { default: RiderHistoryPage } = await import('@/app/rider/history/page');
const testo = () => renderToStaticMarkup(<RiderHistoryPage />).replace(/ | /g, ' ');

const consegna = (id: string, extra: Riga): Riga => ({
  id,
  total_price: 45,
  delivery_status: 'DELIVERED',
  delivered_at: '2026-10-30T10:00:00Z',
  delivery_city: 'Piacenza',
  payment_method: 'card',
  ...extra,
});

beforeEach(() => {
  righe = [];
  colonneLette = '';
  queryFn = null;
});

describe('lo storico consegne del fattorino', () => {
  it('spesa sopra i 30 € (spedizione gratis per il cliente): la consegna vale 3,00 €, non 0,00 €', () => {
    righe = [consegna('aaaaaa11', { shipping_cost: 0, rider_fee_cents: 300 })];
    const html = testo();
    expect(html).toContain('+3,00');
    expect(html).not.toContain('+0,00');
    expect(html).toContain('3,00 € guadagnati');
  });

  it('sotto i 30 €: conta il compenso, non la tariffa pagata dal cliente; il totale del giorno somma i compensi', () => {
    righe = [
      consegna('aaaaaa11', { shipping_cost: 0, rider_fee_cents: 300 }),
      consegna('bbbbbb22', { shipping_cost: 4.9, rider_fee_cents: 400 }),
    ];
    const html = testo();
    expect(html).toContain('+4,00');
    expect(html).not.toContain('4,90');
    expect(html).toContain('7,00 € guadagnati');
  });

  it('consegne vecchie senza compenso salvato: si ripiega sulla spedizione, come il bonifico', () => {
    righe = [consegna('cccccc33', { shipping_cost: 2.5, rider_fee_cents: null })];
    expect(testo()).toContain('+2,50');
  });

  it('la pagina chiede alla vista anche il compenso del fattorino', async () => {
    righe = [];
    testo();
    expect(queryFn).toBeTruthy();
    await queryFn!();
    expect(colonneLette.split(',').map((c) => c.trim())).toContain('rider_fee_cents');
  });
});
