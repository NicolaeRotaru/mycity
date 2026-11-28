/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Onda 2 · R11-006 — Due ordini dello stesso carrello potevano finire a due fattorini diversi, e il
 * secondo faceva un viaggio intero per 1 euro.
 *
 * La regola vera sta nel database: `prendi_ordine` (migrazione 999r_lo_stesso_carrello_va_a_un_
 * fattorino_solo) prende con l'ordine scelto anche gli altri ordini PRONTI e liberi dello stesso
 * carrello, e risponde `insieme`. La prova col database vero è
 * tests/sql/rls/onda2-e2-lo-stesso-carrello-a-un-fattorino.test.sql (Postgres locale). Qui: la
 * bacheca vera dice al fattorino che con la presa sono arrivati anche gli altri ordini, e la
 * migrazione c'è, con la presa atomica e il blocco delle righe in ordine di id.
 */

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const mondo = vi.hoisted(() => ({
  presa: (async () => ({ data: null, error: null })) as (id: string) => Promise<{ data: unknown; error: unknown }>,
  /** Gli ordini che sono già del fattorino «luca». */
  suoi: new Set<string>(),
  /** Fra i suoi, quelli annullati (gli altri sono ASSIGNED). */
  annullati: new Set<string>(),
  avvisiErrore: [] as string[],
  avvisiOk: [] as string[],
  vaiA: [] as string[],
  preseContate: [] as string[],
}));

vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => mondo.avvisiErrore.push(m),
    success: (m: string) => mondo.avvisiOk.push(m),
  },
}));
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: (u: string) => { mondo.vaiA.push(u); }, replace: () => {} }) }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: { href: string; children: unknown }) => ce('a', { href, ...r }, children as never) };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { full_name: 'Luca Verdi' }, userEmail: null }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('@/lib/analytics/events', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  trackRiderOrderAccepted: (id: string) => { mondo.preseContate.push(id); },
}));
vi.mock('@/lib/supabase/client', () => {
  const ordine = (id: string) => ({
    id, seller_id: 'n-pane', store_name: 'Pane Quotidiano', store_address: 'Via Roma 1', delivery_city: 'Piacenza',
    delivery_zip: '29121', delivery_status: 'READY', payment_method: 'card', total_price: 24, shipping_cost: 3,
    rider_fee_cents: 300, delivery_slot: null, articoli: 2, created_at: '2026-11-24T09:00:00Z',
  });
  const catena = (tavola: string) => {
    const uguale: Record<string, unknown> = {};
    const dentro: Record<string, unknown[]> = {};
    const risposta = (una: boolean) => {
      // La bacheca è ancora quella letta prima del secondo tocco: l'ordine A c'è ancora.
      if (tavola === 'ordini_disponibili_rider') return { data: [ordine(A)], error: null };
      if (tavola === 'profiles') return { data: { rider_is_online: true, rider_zones: [] }, error: null };
      if (tavola === 'orders' && una) {
        // Il fattorino legge un ordine solo se è suo (la regola del database sugli ordini).
        const id = String(uguale.id ?? '');
        const stato = mondo.annullati.has(id) ? 'CANCELED' : 'ASSIGNED';
        const passaGliStati = !dentro.delivery_status || dentro.delivery_status.includes(stato);
        return { data: uguale.rider_id === 'luca' && mondo.suoi.has(id) && passaGliStati ? { id } : null, error: null };
      }
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'gte', 'update', 'limit']) c[m] = () => c;
    c.in = (col: string, v: unknown[]) => { dentro[col] = v; return c; };
    c.eq = (col: string, v: unknown) => { uguale[col] = v; return c; };
    c.single = async () => risposta(true);
    c.maybeSingle = async () => risposta(true);
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta(false)).then(ok, ko);
    return c;
  };
  return {
    supabase: {
      from: catena,
      rpc: async (_nome: string, argomenti: { p_order_id: string }) => mondo.presa(argomenti.p_order_id),
      auth: { getUser: async () => ({ data: { user: { id: 'luca' } }, error: null }) },
    },
  };
});

const { default: Bacheca } = await import('@/app/rider/page');

let radice: Root | null = null;
let div: HTMLDivElement | null = null;

const avanza = async (ms: number) => {
  for (let fatto = 0; fatto < ms; fatto += 250) {
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  }
};

async function accendi() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => {
    radice!.render(createElement(QueryClientProvider, { client: qc }, createElement(Bacheca as never)));
  });
  await avanza(500);
  return div;
}

function accettaDi(d: HTMLElement, id: string): HTMLButtonElement | null {
  const numero = `#${id.slice(0, 6).toUpperCase()}`;
  const scheda = [...d.querySelectorAll('span')].find((s) => s.textContent === numero)?.closest('div.rounded-xl');
  if (!scheda) return null;
  return ([...scheda.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Accetta') as HTMLButtonElement) ?? null;
}

async function tocca(b: HTMLButtonElement | null) {
  expect(b, 'il pulsante «Accetta» non c’è').toBeTruthy();
  await act(async () => { b!.click(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
  mondo.suoi = new Set();
  mondo.annullati = new Set();
  mondo.avvisiErrore = [];
  mondo.avvisiOk = [];
  mondo.vaiA = [];
  mondo.preseContate = [];
  // Come il database vero: la prima presa riesce e l'ordine diventa suo; la seconda trova l'ordine
  // non più pronto (è ASSIGNED) e risponde NON_PIU_DISPONIBILE, anche se è suo.
  mondo.presa = async (id) => {
    if (mondo.suoi.has(id)) return { data: { ok: false, motivo: 'NON_PIU_DISPONIBILE' }, error: null };
    mondo.suoi.add(id);
    return { data: { ok: true, id }, error: null };
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R11-006 — la presa dice gli ordini dello stesso carrello presi insieme', () => {
  it('con un altro ordine pronto dello stesso cliente, il fattorino lo sa subito', async () => {
    mondo.presa = async (id) => ({ data: { ok: true, id, insieme: ['bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'] }, error: null });
    const d = await accendi();
    await tocca(accettaDi(d, A));
    await avanza(500);
    expect(mondo.avvisiOk).toEqual(['Ordine assegnato a te, insieme a un altro ordine pronto dello stesso cliente: un giro solo.']);
    expect(mondo.vaiA).toEqual([`/rider/orders/${A}`]);
  }, 30000);

  it('senza altri ordini (o col database di prima, senza `insieme`) resta «Ordine assegnato a te!»', async () => {
    const d = await accendi();
    await tocca(accettaDi(d, A));
    await avanza(500);
    expect(mondo.avvisiOk).toEqual(['Ordine assegnato a te!']);
  }, 30000);
});

describe('R11-006 — la migrazione della presa per carrello', () => {
  const DIR = join(process.cwd(), 'migrations');
  const file = readdirSync(DIR).find((f) => /lo_stesso_carrello_va_a_un_fattorino_solo\.sql$/.test(f));
  const sql = file ? readFileSync(join(DIR, file), 'utf8') : '';

  it('c’è, ridefinisce prendi_ordine e risponde anche `insieme`', () => {
    expect(file, 'manca la presa per carrello nel database').toBeTruthy();
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.prendi_ordine\(p_order_id uuid\)/);
    expect(sql).toMatch(/'insieme', to_jsonb\(v_insieme\)/);
  });

  it('blocca le righe del carrello in ordine di id, e prende solo i PRONTI liberi non ritiro in negozio', () => {
    expect(sql).toMatch(/WHERE id = ANY \(v_giro\) ORDER BY id FOR UPDATE/);
    const seconda = sql.slice(sql.indexOf('WITH presi AS'));
    expect(seconda).toMatch(/rider_id IS NULL/);
    expect(seconda).toMatch(/delivery_status = 'READY'/);
    expect(seconda).toMatch(/COALESCE\(pickup_in_store, false\) = false/);
  });
});
