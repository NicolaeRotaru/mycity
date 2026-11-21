/**
 * @vitest-environment jsdom
 */
/**
 * R01-006 — L'esito del reclamo si legge nella pagina dell'ordine.
 *
 * La campanella dell'esito porta a /orders/<id>, ma la pagina dell'ordine non leggeva la tabella
 * dei reclami: niente esito, «Apri reclamo» sempre lì, e la pagina del reclamo riproponeva il modulo
 * sopra un reclamo già chiuso. Qui le due pagine vere, montate, con un database finto.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const aspetta = async () => { for (let i = 0; i < 15; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const globali = globalThis as Record<string, unknown>;
const ORDINE = 'cccccccc-6006-4006-8006-cccccccccccc';

const riga = {
  id: ORDINE, total_price: 25, shipping_cost: 0, delivery_fee_cents: 0, discount_amount: 0, wallet_applied_cents: 0,
  pickup_in_store: false, delivery_slot: null, delivery_status: 'DELIVERED', payment_status: 'paid', payment_method: 'card',
  stripe_refund_id: null, created_at: '2026-11-10T17:00:00Z', accepted_at: null, ready_at: null, picked_up_at: null,
  delivered_at: '2026-11-11T10:00:00Z',
  delivery_full_name: 'X', delivery_phone: null, delivery_address: 'Via', delivery_city: 'Piacenza', delivery_zip: '29121',
  delivery_notes: null, delivery_lat: null, delivery_lng: null, rider_lat: null, rider_lng: null,
  rider_position_updated_at: null, rider_id: null, seller_id: 'negozio-1', user_id: 'u-1',
  order_items: [{ id: 'r1', quantity: 1, unit_price: 25, product_id: 'p1', product_name: 'Pane', product_image: null, products: { name: 'Pane', images: null } }],
};

let reclamiNelDatabase: unknown[] = [];

function client() {
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'orders') return { data: riga, error: null };
      if (tavola === 'returns') return { data: [], error: null };
      if (tavola === 'disputes') return { data: reclamiNelDatabase, error: null };
      if (tavola.includes('nomi')) return { data: [], error: null };
      return { data: [{ id: 'negozio-1', store_name: 'Pane Quotidiano', store_logo: null, store_phone: null, store_address: null, store_lat: null, store_lng: null }], error: null };
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

const RISOLTO_PER_ME = {
  status: 'resolved_buyer', created_at: '2026-11-12T09:00:00Z',
  resolution_notes: 'Il pane è arrivato schiacciato: ti rimborsiamo la pagnotta.', refund_cents: 1250,
};

async function apriOrdine() {
  globali.__CLIENT_SUPABASE__ = client();
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } } });
  const mod = await monta('app/orders/[id]/page.tsx', { veri: ['@tanstack/react-query'] });
  const Pagina = mod.default as (p: unknown) => unknown;
  const Guscio = () => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params: { id: ORDINE } }));
  const s = accendi(Guscio);
  await aspetta();
  return s;
}

async function apriPaginaDelReclamo() {
  globali.__UTENTE__ = { id: 'u-1', email: 'maria@test.it' };
  globali.__CLIENT_SUPABASE__ = client();
  const pagina = (await monta('app/orders/[id]/dispute/page.tsx')).default;
  const s = accendi(pagina as never, { params: Promise.resolve({ id: ORDINE }) });
  for (let i = 0; i < 15; i++) await attendi();
  return s;
}

afterEach(() => {
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__']) globali[k] = undefined;
  reclamiNelDatabase = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('R01-006 — la pagina dell ordine dice com è finito il reclamo', () => {
  it('reclamo risolto a favore del cliente: esito, rimborso e note; niente «Apri reclamo»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    reclamiNelDatabase = [RISOLTO_PER_ME];
    const s = await apriOrdine();
    const testo = testoVisibile(document.body);
    expect(testo, 'la pagina non si è montata: la prova girerebbe a vuoto').toContain('Ordine consegnato');
    expect(testo, "l'esito annunciato dalla campanella non si trova nella pagina dell'ordine").toContain('Reclamo risolto a tuo favore');
    expect(testo).toContain('12/11/2026');
    expect(testo, 'il rimborso non dice che viene dal reclamo').toMatch(/Rimborso deciso con il reclamo: 12,50/);
    expect(testo).toContain('ti rimborsiamo la pagnotta');
    expect(testo, 'con un reclamo già chiuso resta il pulsante per aprirne un altro').not.toContain('Apri reclamo');
    expect(document.querySelector(`a[href="/orders/${ORDINE}/dispute"]`)?.textContent).toContain('Vedi il reclamo');
    s.smonta();
  }, 60000);

  it('reclamo ancora in esame: lo stato si vede e «Apri reclamo» sparisce', async () => {
    reclamiNelDatabase = [{ status: 'under_review', created_at: '2026-11-12T09:00:00Z', resolution_notes: null, refund_cents: null }];
    const s = await apriOrdine();
    const testo = testoVisibile(document.body);
    expect(testo).toContain('Reclamo in esame');
    expect(testo).not.toContain('Apri reclamo');
    s.smonta();
  }, 60000);

  it('CONTROLLO: senza reclami il pulsante «Apri reclamo» c è', async () => {
    reclamiNelDatabase = [];
    const s = await apriOrdine();
    const testo = testoVisibile(document.body);
    expect(testo).toContain('Apri reclamo');
    expect(testo).not.toMatch(/Reclamo (aperto|in esame|risolto|respinto)/);
    s.smonta();
  }, 60000);
});

describe('R01-006 — la pagina del reclamo non ripropone il modulo sopra un reclamo chiuso', () => {
  it('reclamo respinto: si legge l esito, il modulo non c è', async () => {
    reclamiNelDatabase = [{ status: 'rejected', created_at: '2026-11-12T09:00:00Z', resolution_notes: 'Le foto mostrano la merce integra.', refund_cents: null }];
    const s = await apriPaginaDelReclamo();
    const testo = testoVisibile(document.body);
    expect(testo).toContain('Reclamo respinto');
    expect(testo).toContain('Le foto mostrano la merce integra.');
    expect(document.querySelector('form'), 'sopra un reclamo chiuso la pagina ripropone il modulo').toBeNull();
    expect(document.querySelector('input[name="reason"]')).toBeNull();
    s.smonta();
  }, 60000);

  it('reclamo risolto con rimborso: l importo deciso si legge', async () => {
    reclamiNelDatabase = [RISOLTO_PER_ME];
    const s = await apriPaginaDelReclamo();
    const testo = testoVisibile(document.body);
    expect(testo).toContain('Reclamo risolto a tuo favore');
    expect(testo).toMatch(/Rimborso deciso: 12,50/);
    expect(document.querySelector('form')).toBeNull();
    s.smonta();
  }, 60000);

  it('CONTROLLO: senza reclami il modulo c è', async () => {
    reclamiNelDatabase = [];
    const s = await apriPaginaDelReclamo();
    expect(document.querySelector('input[name="reason"]'), 'il modulo del reclamo si deve vedere').toBeTruthy();
    s.smonta();
  }, 60000);
});
