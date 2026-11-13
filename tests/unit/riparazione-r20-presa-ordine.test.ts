/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R20-011 — Sulla bacheca del fattorino un «Accetta» perso lasciava l'ordine in elenco fino al giro
 * dopo (un minuto), e mentre una presa era in volo giravano TUTTI i pulsanti «Accetta» insieme.
 * Il testo diceva sempre «già preso da un altro rider», anche per un ordine annullato.
 *
 * La pagina si monta per davvero, con il react-query vero e un database finto che risponde come
 * `prendi_ordine` (migrazione 123/270).
 */

const mondo = vi.hoisted(() => ({
  liberi: [] as Array<Record<string, unknown>>,
  lettureBacheca: 0,
  presa: (() => Promise.resolve({ data: null, error: null })) as (id: string) => Promise<{ data: unknown; error: unknown }>,
  toastErrori: [] as string[],
}));

vi.mock('sonner', () => ({
  toast: { error: (m: string) => { mondo.toastErrori.push(m); }, success: () => {} },
}));
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: { href: string; children: unknown }) => ce('a', { href, ...r }, children as never) };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { full_name: 'Luca Verdi' }, userEmail: null }),
}));
vi.mock('@/lib/analytics/events', async (vero) => ({
  ...(await vero<typeof import('@/lib/analytics/events')>()),
  trackRiderOrderAccepted: () => {},
  trackErrorShown: () => {},
}));
vi.mock('@/lib/supabase/client', () => {
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'ordini_disponibili_rider') {
        mondo.lettureBacheca += 1;
        return { data: mondo.liberi.map((o) => ({ ...o })), error: null };
      }
      if (tavola === 'profiles') return { data: { rider_is_online: true, rider_zones: [] }, error: null };
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'gte', 'update', 'limit']) c[m] = () => c;
    c.single = async () => risposta();
    c.maybeSingle = async () => risposta();
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta()).then(ok, ko);
    return c;
  };
  return {
    supabase: {
      from: catena,
      rpc: (_nome: string, a: { p_order_id: string }) => mondo.presa(a.p_order_id),
      auth: { getUser: async () => ({ data: { user: { id: 'luca' } }, error: null }) },
    },
  };
});

const ORDINE = (id: string, negozio: string) => ({
  id, seller_id: `n-${id}`, store_name: negozio, store_address: 'Via Roma 1', delivery_city: 'Piacenza',
  delivery_zip: '29121', delivery_status: 'READY', payment_method: 'card', total_price: 24, shipping_cost: 3,
  rider_fee_cents: 300, delivery_slot: null, articoli: 2, created_at: '2026-11-13T09:00:00Z',
});
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FRUTTA = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const { default: Bacheca } = await import('@/app/rider/page');

let radice: Root | null = null;
let div: HTMLDivElement | null = null;

const gira = async (volte = 10) => {
  for (let i = 0; i < volte; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
};

async function accendi() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => {
    radice!.render(createElement(QueryClientProvider, { client: qc }, createElement(Bacheca as never)));
  });
  await gira();
  return div;
}

const accetta = (d: HTMLElement) =>
  Array.from(d.querySelectorAll('button')).filter((b) => (b.textContent ?? '').includes('Accetta'));
const schedaDi = (d: HTMLElement, negozio: string) =>
  Array.from(d.querySelectorAll('div.rounded-xl')).find((x) => (x.textContent ?? '').includes(negozio) && (x.textContent ?? '').includes('Accetta'));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mondo.liberi = [ORDINE(PANE, 'Pane Quotidiano'), ORDINE(FRUTTA, 'Frutta Bella')];
  mondo.lettureBacheca = 0;
  mondo.toastErrori = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.unstubAllGlobals();
});

describe('R20-011 — l’«Accetta» sulla bacheca del fattorino', () => {
  it('mentre una presa è in volo gira solo il pulsante dell’ordine premuto', async () => {
    let finisci: (v: { data: unknown; error: unknown }) => void = () => {};
    mondo.presa = () => new Promise((r) => { finisci = r; });
    const d = await accendi();
    expect(accetta(d), 'la bacheca non mostra i due ordini: la prova girerebbe a vuoto').toHaveLength(2);

    const sulPane = schedaDi(d, 'Pane Quotidiano')!.querySelector('button')!;
    await act(async () => { sulPane.click(); });
    await gira(3);

    const pane = schedaDi(d, 'Pane Quotidiano')!.querySelector('button')!;
    const frutta = schedaDi(d, 'Frutta Bella')!.querySelector('button')!;
    expect(pane.getAttribute('aria-busy'), 'il pulsante premuto non dice che sta lavorando').toBe('true');
    expect(frutta.getAttribute('aria-busy'), 'gira anche l’«Accetta» di un ordine che nessuno ha toccato').toBeNull();
    expect(frutta.disabled, 'l’«Accetta» dell’altro ordine è spento mentre si prende il primo').toBe(false);

    await act(async () => { finisci({ data: { ok: false, motivo: 'GIA_PRESO' }, error: null }); });
    await gira(3);
  }, 30000);

  it('un «Accetta» perso toglie subito l’ordine dall’elenco e rilegge la bacheca', async () => {
    const d = await accendi();
    expect(accetta(d)).toHaveLength(2);
    const lettePrima = mondo.lettureBacheca;

    // Nel frattempo un altro fattorino l'ha preso: per il database non è più libero.
    mondo.liberi = [ORDINE(FRUTTA, 'Frutta Bella')];
    mondo.presa = async () => ({ data: { ok: false, motivo: 'GIA_PRESO' }, error: null });
    await act(async () => { schedaDi(d, 'Pane Quotidiano')!.querySelector('button')!.click(); });
    await gira();

    expect(mondo.lettureBacheca, 'dopo la presa persa la bacheca non si rilegge: resta il dato vecchio fino al giro dopo').toBeGreaterThan(lettePrima);
    expect(schedaDi(d, 'Pane Quotidiano'), 'l’ordine perso resta in elenco col suo «Accetta»').toBeUndefined();
    expect(schedaDi(d, 'Frutta Bella'), 'è sparito anche l’ordine ancora libero').toBeTruthy();
  }, 30000);

  it('il messaggio non dice «preso da un altro» quando potrebbe essere stato annullato', async () => {
    const d = await accendi();
    mondo.presa = async () => ({ data: { ok: false, motivo: 'GIA_PRESO' }, error: null });
    await act(async () => { schedaDi(d, 'Pane Quotidiano')!.querySelector('button')!.click(); });
    await gira();
    expect(mondo.toastErrori).toHaveLength(1);
    expect(mondo.toastErrori[0]).toMatch(/non è più disponibile/i);
    expect(mondo.toastErrori[0]).toMatch(/non è più pronto/i);
  }, 30000);

  it('controllo: con un altro rifiuto (documenti scaduti) l’ordine resta in elenco', async () => {
    const d = await accendi();
    mondo.presa = async () => ({ data: { ok: false, motivo: 'DOCUMENTI_SCADUTI' }, error: null });
    await act(async () => { schedaDi(d, 'Pane Quotidiano')!.querySelector('button')!.click(); });
    await gira();
    expect(schedaDi(d, 'Pane Quotidiano'), 'un rifiuto che non riguarda l’ordine lo ha tolto dall’elenco').toBeTruthy();
    expect(mondo.toastErrori[0]).toMatch(/Patente o polizza/);
  }, 30000);
});
