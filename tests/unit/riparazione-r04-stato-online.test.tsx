/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

/**
 * R04-011 — Sulla bacheca del fattorino lo stato online ha tre valori: online, offline, non so.
 * Con le regole vere del QueryProvider (un nuovo tentativo dopo un secondo) la lettura caduta,
 * finché aspettava il nuovo tentativo, non era ancora «errore», e la scheda scriveva «Sei offline ·
 * Vai online per iniziare» con l'interruttore attivo; lo stesso senza rete (lettura in pausa) e
 * mentre la prima lettura arrivava. Il voto, nello stesso momento, passava per «nessuna recensione».
 *
 * La pagina vera si monta col react-query vero, con retry e attesa uguali al QueryProvider.
 */

type Risposta = { data: unknown; error: unknown };
const SENZA_RETE = { message: 'TypeError: Failed to fetch', code: '' };

const mondo = vi.hoisted(() => ({
  profilo: async (): Promise<{ data: unknown; error: unknown }> => ({ data: { rider_is_online: true, rider_zones: [] }, error: null }),
  voti: async (): Promise<{ data: unknown; error: unknown }> => ({ data: [{ rating: 5 }, { rating: 4 }], error: null }),
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
vi.mock('@/lib/analytics/events', async (vero) => ({
  ...(await vero<typeof import('@/lib/analytics/events')>()),
  trackErrorShown: () => {},
}));
vi.mock('@/lib/supabase/client', () => {
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'profiles') return mondo.profilo();
      if (tavola === 'rider_reviews') return mondo.voti();
      return Promise.resolve({ data: [], error: null });
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'gte', 'limit']) c[m] = () => c;
    c.single = () => risposta();
    c.maybeSingle = () => risposta();
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => risposta().then(ok, ko);
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
  for (let fatto = 0; fatto < ms; fatto += 50) {
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  }
};

/** Il QueryClient con le regole delle letture del QueryProvider vero (components/providers/QueryProvider.tsx). */
const comeIlProvider = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: 1, retryDelay: (tentativo) => Math.min(1000 * 2 ** tentativo, 8000), refetchOnWindowFocus: false },
    },
  });

async function accendi(qc: QueryClient = comeIlProvider()) {
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => {
    radice!.render(createElement(QueryClientProvider, { client: qc }, createElement(Bacheca as never)));
  });
  await avanza(200);
  return div;
}

const testo = (d: HTMLElement) => (d.textContent ?? '').replace(/\s+/g, ' ');
const interruttore = (d: HTMLElement) => d.querySelector('button[role="switch"]');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  mondo.profilo = async () => ({ data: { rider_is_online: true, rider_zones: [] }, error: null });
  mondo.voti = async () => ({ data: [{ rating: 5 }, { rating: 4 }], error: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R04-011 — lo stato online è online, offline o «non so»; il voto non ignora l’errore', () => {
  it('lettura dello stato caduta, in attesa del nuovo tentativo: «Non so se sei online», non «Sei offline»', async () => {
    mondo.profilo = async () => ({ data: null, error: SENZA_RETE });
    const d = await accendi();
    // Primo tentativo caduto, il secondo parte dopo un secondo: qui siamo nell'attesa.
    expect(testo(d), 'nell’attesa del nuovo tentativo la scheda dice «Sei offline»').not.toMatch(/Sei offline/);
    expect(testo(d)).not.toMatch(/Vai online per/);
    expect(testo(d)).toMatch(/Non so se sei online/);
    expect(interruttore(d), 'senza sapere lo stato l’interruttore non si offre').toBeNull();
    // Caduto anche il nuovo tentativo: resta «non so».
    await avanza(1500);
    expect(testo(d)).toMatch(/Non so se sei online/);
    expect(testo(d)).not.toMatch(/Sei offline/);
  }, 30000);

  it('senza rete la lettura dello stato resta in pausa: «Non so se sei online», non «Sei offline»', async () => {
    const qc = comeIlProvider();
    // La bacheca è già in memoria (si torna sulla pagina), lo stato no; e la rete non c'è.
    qc.setQueryData(queryKeys.rider.orders, { liberi: [], bachecaGuasta: false, miei: [], negoziNonLetti: false });
    onlineManager.setOnline(false);
    const d = await accendi(qc);
    expect(testo(d), 'con la lettura in pausa la scheda dice «Sei offline»').not.toMatch(/Sei offline/);
    expect(testo(d)).toMatch(/Non so se sei online/);
    expect(interruttore(d)).toBeNull();
  }, 30000);

  it('la prima lettura sta arrivando: niente «Sei offline» né interruttore, poi lo stato vero', async () => {
    let rispondi: (r: Risposta) => void = () => {};
    mondo.profilo = () => new Promise<Risposta>((ok) => { rispondi = ok; });
    const d = await accendi();
    expect(testo(d), 'mentre lo stato arriva la scheda dice «Sei offline»').not.toMatch(/Sei offline/);
    expect(interruttore(d)).toBeNull();
    await act(async () => { rispondi({ data: { rider_is_online: true, rider_zones: [] }, error: null }); });
    await avanza(200);
    expect(testo(d)).toMatch(/Sei online/);
    expect(interruttore(d)?.getAttribute('aria-checked')).toBe('true');
  }, 30000);

  it('uno stato letto «offline» resta «Sei offline», con l’interruttore', async () => {
    mondo.profilo = async () => ({ data: { rider_is_online: false, rider_zones: [] }, error: null });
    const d = await accendi();
    expect(testo(d)).toMatch(/Sei offline/);
    expect(testo(d)).toMatch(/Vai online per vedere gli ordini/);
    expect(interruttore(d)?.getAttribute('aria-checked')).toBe('false');
  }, 30000);

  it('lettura del voto caduta, in attesa del nuovo tentativo: la testata lo dice, non «Pronto a consegnare»', async () => {
    mondo.voti = async () => ({ data: null, error: SENZA_RETE });
    const d = await accendi();
    expect(testo(d), 'il voto non letto passa per «nessuna recensione»').not.toMatch(/Pronto a consegnare/);
    expect(testo(d)).toMatch(/Non riesco a leggere il tuo voto/);
    await avanza(1500);
    expect(testo(d)).toMatch(/Non riesco a leggere il tuo voto/);
  }, 30000);
});
