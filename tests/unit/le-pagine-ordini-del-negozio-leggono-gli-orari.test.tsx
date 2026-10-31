/**
 * 30/10/2026 (ondata 24) — LE PAGINE ORDINI DEL NEGOZIO LEGGONO GLI ORARI INSIEME ALL'ORDINE.
 *
 * Lunedì alle 12:00 Pane Quotidiano (lun-sab 9-13 e 16:30-19:30) riceve un ordine per «Oggi ·
 * 13:00–16:30». La lista e il dettaglio scrivevano «entro le 16:30»: la riga si calcolava senza gli
 * orari del negozio, e quindi tornava la fine della fascia. L'ultimo ritiro è alle 12:45.
 *
 * La prova non passa gli orari a mano: prende la lettura VERA della pagina (`queryFn`), la fa girare
 * su un database finto che porta il negozio dentro la riga solo se la lettura lo chiede
 * (`seller:profiles!orders_seller_id_fkey ( store_hours )`), poi disegna la pagina VERA con quei dati.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import QueryProvider from '@/components/providers/QueryProvider';
import SellerOrdersPage from '@/app/seller/orders/page';
import SellerOrderDetailPage from '@/app/seller/orders/[id]/page';

const { stato, ORARI_PQ, Catturato } = vi.hoisted(() => {
  class Catturato extends Error {}
  const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
  return {
    Catturato,
    ORARI_PQ: { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] },
    stato: {
      modo: 'cattura' as 'cattura' | 'dati',
      opzioni: [] as Array<Record<string, unknown>>,
      dati: new Map<string, unknown>(),
      lettoAlle: 0,
    },
  };
});

// La prima lettura della pagina (gli ordini) si prende e si ferma il disegno; al secondo giro la
// pagina riceve i dati che la sua stessa lettura ha tirato su.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@tanstack/react-query')>();
  const finto = (opzioni: Record<string, unknown>) => {
    if (stato.modo === 'cattura') {
      stato.opzioni.push(opzioni);
      throw new Catturato('lettura presa');
    }
    return {
      data: stato.dati.get(JSON.stringify(opzioni.queryKey)),
      isLoading: false, isPending: false, isError: false, isSuccess: true, isFetching: false,
      status: 'success', error: null, dataUpdatedAt: stato.lettoAlle, errorUpdatedAt: 0,
      refetch: async () => ({}), hasNextPage: false, fetchNextPage: async () => ({}), isFetchingNextPage: false,
    };
  };
  return { ...vero, useQuery: finto, useInfiniteQuery: finto };
});

// React 18 nei test non ha `use`: la pagina del dettaglio lo usa solo per leggere i parametri.
vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});

const ID = '11111111-2222-3333-4444-555555555555';
const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
/** Lunedì 2/11/2026 alle 12:00 di Roma (UTC+1). */
const NATO = '2026-11-02T11:00:00.000Z';

vi.mock('@/lib/supabase/client', () => {
  const riga = (colonne: string) => {
    // Come PostgREST: il negozio dentro la riga c'è solo se la lettura lo chiede.
    const conOrari = /seller\s*:\s*profiles!orders_seller_id_fkey\s*\(\s*store_hours\s*\)/.test(colonne);
    return {
      id: ID, user_id: 'cliente-1', seller_id: NEGOZIO, total_price: 12, shipping_cost: 0, delivery_status: 'NEW',
      payment_method: 'cod', delivery_fee_cents: 300, discount_amount: 0, wallet_applied_cents: 0,
      pickup_in_store: false, delivery_slot: 'Oggi · 13:00–16:30', created_at: NATO,
      accepted_at: null, ready_at: null, picked_up_at: null, delivered_at: null, canceled_at: null,
      delivery_full_name: 'Maria Rossi', delivery_phone: '333', delivery_address: 'Via Verdi 10',
      delivery_city: 'Piacenza', delivery_zip: '29121', delivery_notes: null, rider_id: null, rider: null,
      order_items: [],
      ...(conOrari ? { seller: { store_hours: ORARI_PQ } } : {}),
    };
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: NEGOZIO } } }) },
      from: (tabella: string) => {
        let colonne = '';
        const risposta = (una: boolean) =>
          tabella === 'orders' ? { data: una ? riga(colonne) : [riga(colonne)], error: null } : { data: null, error: null };
        const b: Record<string, unknown> = {
          select: (c: string) => { colonne = c; return b; },
          eq: () => b, order: () => b, range: () => b, in: () => b, limit: () => b,
          maybeSingle: () => Promise.resolve(risposta(true)),
          single: () => Promise.resolve(risposta(true)),
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(risposta(false)).then(res, rej),
        };
        return b;
      },
      channel: () => ({ on: function on() { return this; }, subscribe: () => ({}) }),
      removeChannel: () => undefined,
    },
  };
});

async function disegna(rendi: () => JSX.Element, infinita: boolean): Promise<string> {
  stato.modo = 'cattura';
  stato.opzioni.length = 0;
  try {
    renderToString(<QueryProvider>{rendi()}</QueryProvider>);
  } catch (e) {
    if (!(e instanceof Catturato)) throw e;
  }
  const opzioni = stato.opzioni[0];
  expect(opzioni, 'la pagina non ha letto gli ordini').toBeTruthy();
  const leggi = opzioni.queryFn as (ctx: { pageParam?: number }) => Promise<unknown>;
  const letti = await leggi({ pageParam: 0 });
  stato.dati.set(JSON.stringify(opzioni.queryKey), infinita ? { pages: [letti], pageParams: [0] } : letti);
  stato.modo = 'dati';
  stato.lettoAlle = new Date(NATO).getTime();
  return renderToString(<QueryProvider>{rendi()}</QueryProvider>);
}

beforeEach(() => {
  stato.dati.clear();
});

describe('le pagine ordini del negozio dicono l’ultimo ritiro, con gli orari letti dal database', () => {
  it('caso 1 — la lista: lunedì 12:00, «Oggi · 13:00–16:30» → entro le 12:45', async () => {
    const html = await disegna(() => <SellerOrdersPage />, true);
    expect(html).toContain('entro le 12:45 di oggi');
    expect(html).not.toContain('entro le 16:30');
  });

  it('caso 1 — il dettaglio: lunedì 12:00, «Oggi · 13:00–16:30» → entro le 12:45', async () => {
    const html = await disegna(
      () => <SellerOrderDetailPage params={{ valore: { id: ID } } as unknown as Promise<{ id: string }>} />,
      false,
    );
    expect(html).toContain('entro le 12:45 di oggi');
    expect(html).not.toContain('entro le 16:30');
  });
});
