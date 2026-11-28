import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, hydrate } from '@tanstack/react-query';
import { databaseCoiPermessi, DOPO_LA_161, type Dati } from './aiuti/database-coi-permessi';
import { queryKeys } from '@/lib/queries/keys';
import { dimenticaLaVistaSenza126 } from '@/lib/queries/venduto-da';

/**
 * R10-009 — Il precarico della scheda prodotto riempiva la scheda e «Venduto da», ma non lo
 * sconto attivo del prodotto: la scheda (prezzo grande) e il bollino della promo lo chiedono con
 * `queryKeys.products.activeDiscount(id)` e `product_active_discount`, e il browser andava a
 * rileggerlo a ogni apertura, con il prezzo pieno nell'HTML nel frattempo. Qui il precarico VERO
 * col database finto, e un browser che esplode se va in rete per lo sconto.
 */

const { server } = vi.hoisted(() => ({ server: { client: null as unknown } }));
vi.mock('@/lib/supabase/anonimo', () => ({ creaClientAnonimo: () => server.client }));

const PANE = 'n-pane';

function dati(): Dati {
  return {
    profiles: [
      { id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano', store_address: 'Via Roma 1', store_hours: { lun: '7-13' } },
    ],
    products: [
      { id: 'p-focaccia', name: 'Focaccia', description: null, price: 4.5, images: ['f.jpg'], seller_id: PANE, status: 'available', created_at: '2026-10-10', category_id: null, stock: 10, has_variants: false },
      { id: 'p-bozza', name: 'Bozza', description: null, price: 3, images: null, seller_id: PANE, status: 'draft', created_at: '2026-10-11', category_id: null, stock: 1, has_variants: false },
    ],
    categories: [],
  };
}

async function precarico(id: string, sconto: (a: Record<string, unknown>) => unknown) {
  const chieste: Array<Record<string, unknown>> = [];
  const db = databaseCoiPermessi(dati(), DOPO_LA_161, null, {
    product_active_discount: (a) => {
      chieste.push(a);
      return sconto(a);
    },
  });
  server.client = db.client;
  vi.resetModules();
  const { precaricaProdotto } = await import('@/lib/queries/precarico');
  return { stato: await precaricaProdotto(id), chieste };
}

/** La lettura del browser, con la stessa chiave e lo stesso staleTime della scheda: qui non deve partire. */
const esplode = async (): Promise<number> => {
  throw new Error('il browser è andato in rete per lo sconto: il precarico non l\'ha riempito');
};

beforeEach(() => {
  dimenticaLaVistaSenza126();
});

describe('R10-009 — il precarico della scheda porta anche lo sconto attivo', () => {
  it('lo sconto del 15% arriva nello stato del server, e il browser non lo rilegge', async () => {
    const { stato, chieste } = await precarico('p-focaccia', () => 15);
    expect(chieste).toEqual([{ p_product: 'p-focaccia' }]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    hydrate(qc, stato);
    const letto = await qc.fetchQuery({ queryKey: queryKeys.products.activeDiscount('p-focaccia'), queryFn: esplode, staleTime: 60_000 });
    expect(letto).toBe(15);
  });

  it('nessuna promo: lo zero letto davvero si consegna, e il browser non rilegge', async () => {
    const { stato } = await precarico('p-focaccia', () => null);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    hydrate(qc, stato);
    expect(qc.getQueryData(queryKeys.products.activeDiscount('p-focaccia'))).toBe(0);
  });

  it('una lettura dello sconto che cade non diventa «nessuno sconto»: la chiave resta vuota, la scheda arriva lo stesso', async () => {
    const { stato } = await precarico('p-focaccia', () => {
      throw new Error('rete giù');
    });
    const chiavi = stato.queries.map((q) => JSON.stringify(q.queryKey));
    expect(chiavi).toContain(JSON.stringify(queryKeys.products.detail('p-focaccia')));
    expect(chiavi).not.toContain(JSON.stringify(queryKeys.products.activeDiscount('p-focaccia')));
  });

  it('un prodotto che l\'estraneo non vede (bozza): niente sconto in memoria, il browser rilegge tutto', async () => {
    const { stato } = await precarico('p-bozza', () => 20);
    expect(stato.queries).toEqual([]);
  });
});
