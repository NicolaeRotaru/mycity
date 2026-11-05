import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * S06 — La lista ordini del negozio.
 * 2376: una rilettura caduta non nasconde gli ordini già letti.
 * 2180: un ordine veloce già consegnato non dice più «Adesso · arrivo in …».
 * 2349: la riga «entro quando accettare» sta fuori dal nome del collegamento.
 */

const stato = vi.hoisted(() => ({ lettura: {} as Record<string, unknown> }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({ useInfiniteQuery: () => stato.lettura }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: ({ title }: { title: string }) => <p>{title}</p> }));

const { default: Lista } = await import('@/app/seller/orders/page');

const ordine = (p: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001', total_price: 12, delivery_status: 'NEW', payment_method: 'cod',
  created_at: new Date(Date.now() - 60_000).toISOString(), delivery_slot: null, pickup_in_store: false,
  delivery_full_name: 'Maria', delivery_address: 'Via Verdi 10', seller: null, order_items: [], ...p,
});
const lettura = (pagine: unknown[][], isError = false) => ({
  data: { pages: pagine }, isPending: false, isLoading: false, isError, error: isError ? new Error('rete') : null,
  dataUpdatedAt: Date.now(), errorUpdatedAt: 0, refetch: vi.fn(), hasNextPage: false,
});

beforeEach(() => { stato.lettura = lettura([[ordine()]]); });

describe('2376 — rilettura caduta', () => {
  it('gli ordini già letti restano, con un avviso', () => {
    stato.lettura = lettura([[ordine({ delivery_full_name: 'Maria Rossi' })]], true);
    const html = renderToStaticMarkup(<Lista />);
    expect(html).toContain('Maria Rossi');
    expect(html).toContain('Non riesco ad aggiornare gli ordini');
    expect(html).not.toContain('Non sono riuscito a leggere i tuoi ordini');
  });
  it('senza nessun ordine letto resta la pagina d\'errore', () => {
    stato.lettura = { ...lettura([], true), data: undefined };
    expect(renderToStaticMarkup(<Lista />)).toContain('Non sono riuscito a leggere i tuoi ordini');
  });
});

describe('2180 — la veloce già consegnata', () => {
  it('non mostra «Adesso · arrivo in …»', () => {
    stato.lettura = lettura([[ordine({ delivery_status: 'DELIVERED', delivery_slot: ETICHETTA_ADESSO })]]);
    expect(renderToStaticMarkup(<Lista />)).not.toContain(ETICHETTA_ADESSO);
  });
  it('sull\'ordine nuovo sì', () => {
    stato.lettura = lettura([[ordine({ delivery_slot: ETICHETTA_ADESSO })]]);
    expect(renderToStaticMarkup(<Lista />)).toContain(ETICHETTA_ADESSO);
  });
});

describe('2349 — la riga della scadenza', () => {
  it('sta fuori dal collegamento', () => {
    stato.lettura = lettura([[ordine({ delivery_slot: ETICHETTA_ADESSO })]]);
    const html = renderToStaticMarkup(<Lista />);
    const link = html.slice(html.indexOf('<a '), html.indexOf('</a>'));
    expect(html).toMatch(/È una consegna veloce|consegna veloce/);
    expect(link).not.toMatch(/consegna veloce/);
  });
});
