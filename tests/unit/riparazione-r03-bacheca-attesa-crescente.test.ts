/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R03-005 — Sulla bacheca del fattorino, con la vista dei negozi giù, la pagina rileggeva tutto
 * ogni 5 secondi senza fine: nessun tetto, nessuna attesa crescente. Un guasto lungo moltiplicava
 * le letture di ogni fattorino con la bacheca aperta.
 *
 * La pagina vera si monta col react-query vero e l'orologio finto. Si annota l'istante di ogni
 * lettura della vista dei negozi e si guardano le attese fra una e l'altra: devono crescere
 * (5, 10, 20, 40 s) fino al minuto normale, e tornare da capo quando la vista risponde.
 */

const mondo = vi.hoisted(() => ({
  vistaGiu: false,
  lettureVista: [] as number[],
}));

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }));
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
vi.mock('@/lib/supabase/client', () => {
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'orders') {
        return {
          data: [{
            id: 'cccccccc-3333-4333-8333-cccccccccccc', total_price: 24, shipping_cost: 3, rider_fee_cents: 300,
            delivery_status: 'ASSIGNED', delivery_city: 'Piacenza', delivery_address: 'Via Verdi 2',
            payment_method: 'card', user_id: 'maria', rider_id: 'luca', seller_id: 'n-pane',
            delivery_slot: null, created_at: '2026-11-17T09:00:00Z', order_items: [{ id: 'r1', quantity: 1 }],
          }],
          error: null,
        };
      }
      if (tavola === 'seller_public_profiles') {
        mondo.lettureVista.push(Date.now());
        if (mondo.vistaGiu) return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
        return { data: [{ id: 'n-pane', store_name: 'Pane Quotidiano', store_logo: null, store_address: 'Via Roma 1' }], error: null };
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
      rpc: async () => ({ data: null, error: null }),
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

/** Le attese fra una lettura della vista e la successiva, in secondi interi. */
const attese = (dall = 0) =>
  mondo.lettureVista.slice(dall).slice(1).map((t, i) => Math.round((t - mondo.lettureVista[dall + i]) / 1000));

const consegna = (d: HTMLElement) => d.querySelector('a[href^="/rider/orders/"]')?.textContent ?? '';

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  mondo.vistaGiu = false;
  mondo.lettureVista = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R03-005 — con la vista dei negozi giù, la bacheca aspetta sempre di più, fino al minuto', () => {
  it('le attese crescono 5, 10, 20, 40 s e poi restano a 60 s', async () => {
    mondo.vistaGiu = true;
    await accendi();
    await avanza(200_000); // letture a 0, 5, 15, 35, 75, 135, 195 s
    expect(
      attese(),
      'con la vista giù la bacheca si rilegge a ritmo fisso: nessuna attesa crescente e nessun tetto',
    ).toEqual([5, 10, 20, 40, 60, 60]);
    expect(mondo.lettureVista.length, 'in poco più di tre minuti la bacheca si è riletta troppe volte').toBeLessThanOrEqual(7);
  }, 60000);

  it('quando la vista risponde torna al minuto normale, e un guasto nuovo riparte da 5 s', async () => {
    mondo.vistaGiu = true;
    const d = await accendi();
    await avanza(40_000); // letture a 0, 5, 15, 35 s: tutte giù
    expect(attese()).toEqual([5, 10, 20]);

    mondo.vistaGiu = false;
    await avanza(45_000); // la lettura dei 75 s trova la vista: nome del negozio a schermo
    expect(consegna(d)).toContain('Pane Quotidiano');
    const dopoIlRitorno = mondo.lettureVista.length - 1;

    mondo.vistaGiu = true; // la lettura normale (un minuto dopo) cade di nuovo
    await avanza(60_000);
    expect(
      attese(dopoIlRitorno),
      'dopo il ritorno della vista: un minuto, poi la ripresa da 5 s',
    ).toEqual([60, 5]);
  }, 60000);
});
