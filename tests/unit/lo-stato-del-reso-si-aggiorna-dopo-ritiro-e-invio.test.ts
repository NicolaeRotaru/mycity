/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
const aspetta = async () => { for (let i = 0; i < 15; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
const ORDINE = 'bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb';

const riga = {
  id: ORDINE, total_price: 25, shipping_cost: 0, delivery_fee_cents: 0, discount_amount: 0, wallet_applied_cents: 0,
  pickup_in_store: false, delivery_slot: null, delivery_status: 'DELIVERED', payment_status: 'paid', payment_method: 'card',
  stripe_refund_id: null, created_at: '2026-10-14T17:00:00Z', accepted_at: null, ready_at: null, picked_up_at: null,
  delivered_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  delivery_full_name: 'X', delivery_phone: null, delivery_address: 'Via', delivery_city: 'Piacenza', delivery_zip: '29121',
  delivery_notes: null, delivery_lat: null, delivery_lng: null, rider_lat: null, rider_lng: null,
  rider_position_updated_at: null, rider_id: null, seller_id: 'negozio-1',
  order_items: [{ id: 'r1', quantity: 1, unit_price: 25, product_id: 'p1', product_name: 'Pane', product_image: null, products: { name: 'Pane', images: null } }],
};

let resiNelDatabase: unknown[] = [];

function client() {
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'orders') return { data: riga, error: null };
      if (tavola === 'returns') return { data: resiNelDatabase, error: null };
      if (tavola.includes('nomi')) return { data: [], error: null };
      return { data: [{ id: 'negozio-1', store_name: 'Pane', store_logo: null, store_phone: null, store_address: null, store_lat: null, store_lng: null }], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is', 'neq']) c[m] = () => c;
    c.maybeSingle = async () => risposta();
    c.single = async () => risposta();
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta()).then(ok, ko);
    return c;
  };
  return { from: catena };
}

afterEach(() => {
  globali.__CLIENT_SUPABASE__ = undefined;
  document.body.innerHTML = '';
});

describe('collaudo RB: dopo il ritiro la pagina dell ordine dice lo stato vero', () => {
  it('ritirata la richiesta e tornati all ordine (entro 30 secondi), la pagina non dice ancora «Reso richiesto»', async () => {
    globali.__CLIENT_SUPABASE__ = client();
    // La stessa cache della produzione (components/providers/QueryProvider.tsx).
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 300_000, refetchOnWindowFocus: false, retry: 1 } } });
    const mod = await monta('app/orders/[id]/page.tsx', { veri: ['@tanstack/react-query'] });
    const Pagina = mod.default as (p: unknown) => unknown;
    const Guscio = () => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { id: ORDINE } }));

    // 1. Il cliente apre l'ordine: c'e' un reso aperto.
    resiNelDatabase = [{ id: 'reso-1', status: 'REQUESTED', created_at: '2026-10-15T09:00:00Z' }];
    const prima = accendi(Guscio);
    await aspetta();
    expect(prima.radice.textContent, 'la pagina non mostra il reso aperto: la prova girerebbe a vuoto').toContain('Reso richiesto');
    expect(prima.radice.textContent).toContain('Vedi la richiesta');
    prima.smonta();

    // 2. Va sulla richiesta, preme «Ritira la richiesta»: nel database il reso diventa CANCELED.
    resiNelDatabase = [{ id: 'reso-1', status: 'CANCELED', created_at: '2026-10-15T09:00:00Z' }];

    // 3. La pagina del reso lo rimanda all'ordine (router.push): stessa cache, pochi secondi dopo.
    const dopo = accendi(Guscio);
    await aspetta();
    const testo = dopo.radice.textContent ?? '';
    expect(testo, 'dopo il ritiro la pagina dice ancora che il reso aspetta il negozio').not.toContain('Reso richiesto');
    expect(testo).toContain('Richiesta di reso annullata');
    dopo.smonta();
  }, 60000);
  it('CONTROLLO con la cache svuotata: ritirata la richiesta e tornati all ordine (entro 30 secondi), la pagina non dice ancora «Reso richiesto»', async () => {
    globali.__CLIENT_SUPABASE__ = client();
    // La stessa cache della produzione (components/providers/QueryProvider.tsx).
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 300_000, refetchOnWindowFocus: false, retry: 1 } } });
    const mod = await monta('app/orders/[id]/page.tsx', { veri: ['@tanstack/react-query'] });
    const Pagina = mod.default as (p: unknown) => unknown;
    const Guscio = () => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { id: ORDINE } }));

    // 1. Il cliente apre l'ordine: c'e' un reso aperto.
    resiNelDatabase = [{ id: 'reso-1', status: 'REQUESTED', created_at: '2026-10-15T09:00:00Z' }];
    const prima = accendi(Guscio);
    await aspetta();
    expect(prima.radice.textContent, 'la pagina non mostra il reso aperto: la prova girerebbe a vuoto').toContain('Reso richiesto');
    expect(prima.radice.textContent).toContain('Vedi la richiesta');
    prima.smonta();

    // 2. Va sulla richiesta, preme «Ritira la richiesta»: nel database il reso diventa CANCELED.
    resiNelDatabase = [{ id: 'reso-1', status: 'CANCELED', created_at: '2026-10-15T09:00:00Z' }];

    await qc.invalidateQueries();
    // 3. La pagina del reso lo rimanda all'ordine (router.push): stessa cache, pochi secondi dopo.
    const dopo = accendi(Guscio);
    await aspetta();
    const testo = dopo.radice.textContent ?? '';
    expect(testo, 'dopo il ritiro la pagina dice ancora che il reso aspetta il negozio').not.toContain('Reso richiesto');
    expect(testo).toContain('Richiesta di reso annullata');
    dopo.smonta();
  }, 60000);
  it('inviato un reso nuovo e tornati all ordine, la pagina dice che e partito', async () => {
    globali.__CLIENT_SUPABASE__ = client();
    // La stessa cache della produzione (components/providers/QueryProvider.tsx).
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 300_000, refetchOnWindowFocus: false, retry: 1 } } });
    const mod = await monta('app/orders/[id]/page.tsx', { veri: ['@tanstack/react-query'] });
    const Pagina = mod.default as (p: unknown) => unknown;
    const Guscio = () => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { id: ORDINE } }));

    // 1. Il cliente apre l'ordine: c'e' un reso aperto.
    resiNelDatabase = [];
    const prima = accendi(Guscio);
    await aspetta();
    expect(prima.radice.textContent).toContain('Richiedi reso');
    prima.smonta();

    // 2. Va sulla richiesta, preme «Ritira la richiesta»: nel database il reso diventa CANCELED.
    resiNelDatabase = [{ id: 'reso-2', status: 'REQUESTED', created_at: '2026-10-16T09:00:00Z' }];

    // 3. La pagina del reso lo rimanda all'ordine (router.push): stessa cache, pochi secondi dopo.
    const dopo = accendi(Guscio);
    await aspetta();
    const testo = dopo.radice.textContent ?? '';
    expect(testo, 'il reso appena inviato non si vede').toContain('Reso richiesto');
    dopo.smonta();
  }, 60000);
});
