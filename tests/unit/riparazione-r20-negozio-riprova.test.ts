/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R20-007 — Sulla bacheca del fattorino, se la vista dei negozi cadeva per un attimo, la consegna
 * in corso restava con «Negozio» al posto del nome fino al giro dopo (un minuto): la lettura
 * contava come riuscita e nessuno la riprovava subito.
 *
 * La pagina si monta col react-query vero e l'orologio finto: la vista dei negozi cade alla prima
 * lettura e torna subito dopo. Il nome deve tornare in pochi secondi, non dopo un minuto.
 */

const mondo = vi.hoisted(() => ({
  vistaGiu: 0,
  lettureVista: 0,
  lettureMiei: 0,
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
        mondo.lettureMiei += 1;
        return {
          data: [{
            id: 'cccccccc-3333-4333-8333-cccccccccccc', total_price: 24, shipping_cost: 3, rider_fee_cents: 300,
            delivery_status: 'ASSIGNED', delivery_city: 'Piacenza', delivery_address: 'Via Verdi 2',
            payment_method: 'card', user_id: 'maria', rider_id: 'luca', seller_id: 'n-pane',
            delivery_slot: null, created_at: '2026-11-13T09:00:00Z', order_items: [{ id: 'r1', quantity: 1 }],
          }],
          error: null,
        };
      }
      if (tavola === 'seller_public_profiles') {
        mondo.lettureVista += 1;
        if (mondo.vistaGiu > 0) {
          mondo.vistaGiu -= 1;
          return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
        }
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

const consegna = (d: HTMLElement) => d.querySelector('a[href^="/rider/orders/"]')?.textContent ?? '';

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  mondo.vistaGiu = 0;
  mondo.lettureVista = 0;
  mondo.lettureMiei = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R20-007 — il nome del negozio dopo un guasto passeggero della vista', () => {
  it('la vista cade una volta: il nome torna entro pochi secondi, non al giro dopo', async () => {
    mondo.vistaGiu = 1;
    const d = await accendi();
    expect(consegna(d), 'la consegna in corso non si è disegnata').toContain('Negozio');
    expect(consegna(d)).not.toContain('Pane Quotidiano');

    await avanza(10_000);
    expect(
      consegna(d),
      'dopo 10 secondi la consegna dice ancora «Negozio»: la lettura parziale non è stata riprovata',
    ).toContain('Pane Quotidiano');
  }, 30000);

  it('controllo: con la vista sana la bacheca non si rilegge ogni pochi secondi', async () => {
    const d = await accendi();
    expect(consegna(d)).toContain('Pane Quotidiano');
    const letture = mondo.lettureMiei;
    await avanza(20_000);
    expect(mondo.lettureMiei, 'la bacheca si rilegge di continuo anche quando la lettura è completa').toBe(letture);
  }, 30000);
});
