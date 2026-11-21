/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R04-007 — Sulla bacheca del fattorino un «Accetta» perso (l'ordine l'ha preso un altro, o non è
 * più pronto) lasciava l'ordine in elenco col suo «Accetta» fino al giro successivo (un minuto), e
 * mentre una presa viaggiava giravano tutti i pulsanti insieme.
 *
 * La pagina vera si monta col react-query vero, con due ordini pronti (A e B). Il database finto
 * fa come quello vero: dopo una presa persa la bacheca non riporta più l'ordine perso.
 */

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const mondo = vi.hoisted(() => ({
  presa: (async () => ({ data: null, error: null })) as (id: string) => Promise<{ data: unknown; error: unknown }>,
  persi: new Set<string>(),
  lettureBacheca: 0,
  avvisiErrore: [] as string[],
}));

vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => mondo.avvisiErrore.push(m),
    success: () => {},
  },
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
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('@/lib/analytics/events', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  trackRiderOrderAccepted: () => {},
}));
vi.mock('@/lib/supabase/client', () => {
  const ordine = (id: string, negozio: string) => ({
    id, seller_id: `n-${negozio}`, store_name: negozio, store_address: 'Via Roma 1', delivery_city: 'Piacenza',
    delivery_zip: '29121', delivery_status: 'READY', payment_method: 'card', total_price: 24, shipping_cost: 3,
    rider_fee_cents: 300, delivery_slot: null, articoli: 2, created_at: '2026-11-21T09:00:00Z',
  });
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'ordini_disponibili_rider') {
        mondo.lettureBacheca += 1;
        return {
          data: [ordine(A, 'Pane Quotidiano'), ordine(B, 'Frutta Bella')].filter((o) => !mondo.persi.has(o.id)),
          error: null,
        };
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

/** Il pulsante «Accetta» della scheda dell'ordine (cercata dal suo numero corto), o null se la scheda non c'è. */
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
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  mondo.persi = new Set();
  mondo.lettureBacheca = 0;
  mondo.avvisiErrore = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R04-007 — un «Accetta» perso toglie subito l’ordine, e gira solo il pulsante premuto', () => {
  it('GIA_PRESO: l’ordine esce subito dall’elenco e la bacheca si rilegge, senza aspettare il minuto', async () => {
    mondo.presa = async (id) => {
      mondo.persi.add(id); // un altro fattorino l'ha preso: la bacheca vera non lo riporta più
      return { data: { ok: false, motivo: 'GIA_PRESO' }, error: null };
    };
    const d = await accendi();
    const lettePrima = mondo.lettureBacheca;
    await tocca(accettaDi(d, A));
    await avanza(1000);
    expect(mondo.avvisiErrore).toEqual(['Ordine già preso da un altro rider']);
    expect(accettaDi(d, A), 'l’ordine perso è ancora in elenco col suo «Accetta»').toBeNull();
    expect(mondo.lettureBacheca, 'la bacheca non si è riletta dopo la presa persa').toBeGreaterThan(lettePrima);
    expect(accettaDi(d, B), 'l’altro ordine deve restare').not.toBeNull();
    expect(accettaDi(d, B)!.disabled).toBe(false);
  }, 30000);

  it('NON_PIU_DISPONIBILE (annullato o tornato in preparazione): non dice «preso da un altro», e l’ordine esce', async () => {
    mondo.presa = async (id) => {
      mondo.persi.add(id);
      return { data: { ok: false, motivo: 'NON_PIU_DISPONIBILE' }, error: null };
    };
    const d = await accendi();
    await tocca(accettaDi(d, A));
    await avanza(1000);
    expect(mondo.avvisiErrore).toHaveLength(1);
    expect(mondo.avvisiErrore[0]).toMatch(/non è più disponibile/i);
    expect(mondo.avvisiErrore[0]).not.toMatch(/un altro/i);
    expect(accettaDi(d, A)).toBeNull();
  }, 30000);

  it('una presa non riuscita per un altro motivo (profilo non approvato) lascia l’ordine dov’è', async () => {
    mondo.presa = async () => ({ data: { ok: false, motivo: 'NON_FATTORINO' }, error: null });
    const d = await accendi();
    await tocca(accettaDi(d, A));
    await avanza(1000);
    expect(mondo.avvisiErrore).toEqual(['Il tuo profilo fattorino non è ancora approvato']);
    expect(accettaDi(d, A)).not.toBeNull();
  }, 30000);

  it('mentre la presa di A viaggia gira solo A; B resta fermo (spento, senza rotella)', async () => {
    let rispondi: (x: { data: unknown; error: unknown }) => void = () => {};
    mondo.presa = () => new Promise((ok) => { rispondi = ok; });
    const d = await accendi();
    await tocca(accettaDi(d, A));
    await avanza(250);
    const a = accettaDi(d, A)!;
    const b = accettaDi(d, B)!;
    expect(a.getAttribute('aria-busy'), 'il pulsante premuto deve girare').toBe('true');
    expect(b.getAttribute('aria-busy'), 'il pulsante di un altro ordine non deve girare').toBeNull();
    expect(b.querySelector('.animate-spin'), 'nessuna rotella sul pulsante di B').toBeNull();
    expect(b.disabled, 'una presa alla volta: B resta spento finché A non torna').toBe(true);
    await act(async () => { rispondi({ data: { ok: false, motivo: 'NON_FATTORINO' }, error: null }); });
    await avanza(500);
    expect(accettaDi(d, A)!.getAttribute('aria-busy')).toBeNull();
    expect(accettaDi(d, B)!.disabled).toBe(false);
  }, 30000);
});
