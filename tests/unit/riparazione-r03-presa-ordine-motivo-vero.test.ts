/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R03-009 — Sulla bacheca del fattorino, ogni presa non riuscita senza un motivo noto diventava
 * «Ordine già preso da un altro rider»: anche una risposta vuota, storta o con un motivo che la
 * pagina non conosce. «Già preso» deve uscire solo col motivo che lo significa (GIA_PRESO di
 * `prendi_ordine`); il resto è «non siamo riusciti a prendere l'ordine».
 *
 * La pagina vera si monta col react-query vero: la bacheca ha un ordine pronto, il fattorino tocca
 * «Accetta», e `prendi_ordine` risponde come decide la prova. Si legge l'avviso che compare.
 */

const mondo = vi.hoisted(() => ({
  rispostaPresa: { data: null, error: null } as { data: unknown; error: unknown },
  avvisiErrore: [] as string[],
  avvisiOk: [] as string[],
}));

vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => mondo.avvisiErrore.push(m),
    success: (m: string) => mondo.avvisiOk.push(m),
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
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'ordini_disponibili_rider') {
        return {
          data: [{
            id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', seller_id: 'n-pane', store_name: 'Pane Quotidiano',
            store_address: 'Via Roma 1', delivery_city: 'Piacenza', delivery_zip: '29121', delivery_status: 'READY',
            payment_method: 'card', total_price: 24, shipping_cost: 3, rider_fee_cents: 300, delivery_slot: null,
            articoli: 2, created_at: '2026-11-17T09:00:00Z',
          }],
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
      rpc: async () => mondo.rispostaPresa,
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

/** Tocca «Accetta» sull'ordine pronto e torna gli avvisi d'errore comparsi. */
async function prendi(risposta: { data: unknown; error: unknown }) {
  mondo.rispostaPresa = risposta;
  const d = await accendi();
  const accetta = [...d.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Accetta');
  expect(accetta, 'il pulsante «Accetta» dell’ordine pronto non c’è').toBeTruthy();
  await act(async () => {
    accetta!.click();
  });
  await avanza(500);
  return mondo.avvisiErrore;
}

const GIA_PRESO = 'Ordine già preso da un altro rider';

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  mondo.avvisiErrore = [];
  mondo.avvisiOk = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R03-009 — «già preso» solo quando il server dice che è già preso', () => {
  it('risposta vuota (null): non dice che l’ha preso un altro', async () => {
    const avvisi = await prendi({ data: null, error: null });
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0]).not.toBe(GIA_PRESO);
    expect(avvisi[0]).toMatch(/non siamo riusciti a prendere l'ordine/i);
  }, 30000);

  it('motivo sconosciuto: non dice che l’ha preso un altro', async () => {
    const avvisi = await prendi({ data: { ok: false, motivo: 'MOTIVO_NUOVO' }, error: null });
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0]).not.toBe(GIA_PRESO);
    expect(avvisi[0]).toMatch(/non siamo riusciti a prendere l'ordine/i);
  }, 30000);

  it('risposta storta (una stringa, o ok senza id): non dice che l’ha preso un altro', async () => {
    const avvisi = await prendi({ data: 'boh', error: null });
    expect(avvisi[0]).toMatch(/non siamo riusciti a prendere l'ordine/i);
    await act(async () => { radice?.unmount(); });
    div?.remove();
    mondo.avvisiErrore = [];
    const avvisi2 = await prendi({ data: { ok: true }, error: null });
    expect(avvisi2[0]).toMatch(/non siamo riusciti a prendere l'ordine/i);
  }, 30000);

  it('GIA_PRESO: «Ordine già preso da un altro rider»', async () => {
    const avvisi = await prendi({ data: { ok: false, motivo: 'GIA_PRESO' }, error: null });
    expect(avvisi).toEqual([GIA_PRESO]);
  }, 30000);

  it('i due motivi già noti restano i loro', async () => {
    const avvisi = await prendi({ data: { ok: false, motivo: 'NON_FATTORINO' }, error: null });
    expect(avvisi).toEqual(['Il tuo profilo fattorino non è ancora approvato']);
    await act(async () => { radice?.unmount(); });
    div?.remove();
    mondo.avvisiErrore = [];
    const avvisi2 = await prendi({ data: { ok: false, motivo: 'DOCUMENTI_SCADUTI' }, error: null });
    expect(avvisi2[0]).toMatch(/Patente o polizza RC scadute/);
  }, 30000);
});
