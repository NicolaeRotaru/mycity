/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R04-015 — Sulla bacheca del fattorino l'interruttore online scriveva lo stato nuovo e poi
 * rileggeva il profilo. Se la scrittura riusciva ma la rilettura cadeva, la scheda restava sul
 * vecchio stato: «Sei offline» a un fattorino che il database dava già online (e che quindi
 * riceveva consegne), con l'interruttore spento.
 *
 * La pagina vera si monta col react-query vero. Il database finto accetta la scrittura e fa cadere
 * ogni lettura del profilo che viene dopo.
 */

const mondo = vi.hoisted(() => ({
  onlineNelDatabase: false,
  scritture: 0,
  /** Se vero, le letture del profilo dopo la scrittura cadono. */
  riletturaCade: true,
  toastOk: [] as string[],
  toastErrori: [] as string[],
}));

vi.mock('sonner', () => ({
  toast: { error: (m: string) => { mondo.toastErrori.push(m); }, success: (m: string) => { mondo.toastOk.push(m); } },
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
  trackErrorShown: () => {},
}));
vi.mock('@/lib/supabase/client', () => {
  const catena = (tavola: string) => {
    let scrive: { rider_is_online?: boolean } | null = null;
    const risposta = () => {
      if (scrive) {
        mondo.scritture += 1;
        if (typeof scrive.rider_is_online === 'boolean') mondo.onlineNelDatabase = scrive.rider_is_online;
        return { data: null, error: null };
      }
      if (tavola === 'profiles') {
        if (mondo.scritture > 0 && mondo.riletturaCade) return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
        return { data: { rider_is_online: mondo.onlineNelDatabase, rider_zones: [] }, error: null };
      }
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'gte', 'limit']) c[m] = () => c;
    c.update = (valori: { rider_is_online?: boolean }) => { scrive = valori; return c; };
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

const gira = async (volte = 12) => {
  for (let i = 0; i < volte; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
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
  await gira();
  return div;
}

const interruttore = (d: HTMLElement) => d.querySelector('button[role="switch"]') as HTMLButtonElement | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mondo.onlineNelDatabase = false;
  mondo.scritture = 0;
  mondo.riletturaCade = true;
  mondo.toastOk = [];
  mondo.toastErrori = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.unstubAllGlobals();
});

describe('R04-015 — interruttore riuscito, rilettura caduta: la scheda mostra lo stato nuovo', () => {
  it('offline → online: il database lo dà online, la rilettura cade, la scheda dice «Sei online»', async () => {
    const d = await accendi();
    expect(d.textContent).toContain('Sei offline');
    await act(async () => { interruttore(d)!.click(); });
    await gira();
    expect(mondo.scritture).toBe(1);
    expect(mondo.onlineNelDatabase).toBe(true);
    expect(mondo.toastOk).toHaveLength(1);
    expect(d.textContent, 'la scheda è rimasta sul vecchio stato dopo una scrittura riuscita').toContain('Sei online');
    expect(interruttore(d)!.getAttribute('aria-checked')).toBe('true');
  });

  it('online → offline: stessa cosa al contrario', async () => {
    mondo.onlineNelDatabase = true;
    const d = await accendi();
    expect(interruttore(d)!.getAttribute('aria-checked')).toBe('true');
    await act(async () => { interruttore(d)!.click(); });
    await gira();
    expect(mondo.onlineNelDatabase).toBe(false);
    expect(interruttore(d)!.getAttribute('aria-checked')).toBe('false');
    expect(d.textContent).toContain('Sei offline');
  });

  it('con la rilettura che riesce la scheda segue il database, come prima', async () => {
    mondo.riletturaCade = false;
    const d = await accendi();
    await act(async () => { interruttore(d)!.click(); });
    await gira();
    expect(interruttore(d)!.getAttribute('aria-checked')).toBe('true');
    expect(d.textContent).toContain('Sei online');
  });
});
