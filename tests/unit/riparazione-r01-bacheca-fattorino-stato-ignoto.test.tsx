/**
 * @vitest-environment jsdom
 *
 * Sulla bacheca del fattorino, se la lettura dello stato online cadeva, la pagina scriveva
 * «Sei offline» (e «Vai online per vedere gli ordini»): il fattorino, magari online davvero,
 * credeva di non ricevere consegne. Anche il voto ignorava l'errore e passava per «nessuna
 * recensione». Adesso una lettura caduta si dice: «Non so se sei online» con «Riprova», e la
 * testata dice che non riesce a leggere il voto. La pagina si monta col react-query vero.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  profiloCade: false,
  votiCadono: false,
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
  const SENZA_RETE = { message: 'TypeError: Failed to fetch', code: '' };
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'profiles') {
        return mondo.profiloCade
          ? { data: null, error: SENZA_RETE }
          : { data: { rider_is_online: true, rider_zones: [] }, error: null };
      }
      if (tavola === 'rider_reviews') {
        return mondo.votiCadono ? { data: null, error: SENZA_RETE } : { data: [{ rating: 5 }, { rating: 4 }], error: null };
      }
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'gte', 'limit']) c[m] = () => c;
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

const gira = async (volte = 10) => {
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

const testo = (d: HTMLElement) => (d.textContent ?? '').replace(/\s+/g, ' ');
const bottone = (d: HTMLElement, re: RegExp) =>
  Array.from(d.querySelectorAll('button')).find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mondo.profiloCade = false;
  mondo.votiCadono = false;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.unstubAllGlobals();
});

describe('bacheca del fattorino: una lettura caduta non è «sei offline» né «nessun voto»', () => {
  it('con la lettura dello stato caduta dice che non lo sa, non «Sei offline»; col «Riprova» riuscito torna l’interruttore', async () => {
    mondo.profiloCade = true;
    const d = await accendi();
    expect(testo(d), 'la lettura è caduta e la pagina dice al fattorino che è offline').not.toMatch(/Sei offline/);
    expect(testo(d)).not.toMatch(/Vai online per/);
    expect(testo(d)).toMatch(/Non so se sei online/);
    expect(d.querySelector('button[role="switch"]'), 'senza sapere lo stato l’interruttore non si offre').toBeNull();

    mondo.profiloCade = false;
    const riprova = bottone(d, /^\s*Riprova\s*$/);
    expect(riprova, 'manca il «Riprova» dello stato').toBeTruthy();
    await act(async () => { riprova!.click(); });
    await gira();
    expect(testo(d)).toMatch(/Sei online/);
    expect(d.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  }, 30000);

  it('con la lettura riuscita la scheda resta quella di sempre', async () => {
    const d = await accendi();
    expect(testo(d)).toMatch(/Sei online/);
    expect(testo(d)).not.toMatch(/Non so se sei online/);
    expect(testo(d)).toMatch(/4,5 · 2 recensioni/);
  }, 30000);

  it('con la lettura del voto caduta la testata lo dice, invece di «Pronto a consegnare» come senza recensioni', async () => {
    mondo.votiCadono = true;
    const d = await accendi();
    expect(testo(d), 'il voto non letto passa per «nessuna recensione»').not.toMatch(/Pronto a consegnare/);
    expect(testo(d)).toMatch(/Non riesco a leggere il tuo voto/);

    mondo.votiCadono = false;
    const riprova = bottone(d, /^\s*Riprova\s*$/);
    await act(async () => { riprova!.click(); });
    await gira();
    expect(testo(d)).toMatch(/4,5 · 2 recensioni/);
  }, 30000);
});
