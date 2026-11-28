/**
 * @vitest-environment jsdom
 *
 * R11-003 — Sulla bacheca del fattorino i tre riquadri di oggi dicevano «Oggi», «Consegne» e
 * «Rating»: l'ultima casella era rimasta in inglese, mentre la testata della stessa pagina parla
 * del «tuo voto» e il resto del sito dice «Voto» (R07-006). Nella pagina delle recensioni del
 * fattorino il consiglio si intitolava «Come migliorare il rating».
 *
 * Qui le due pagine vere, montate col react-query vero: si guarda cosa legge il fattorino.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
vi.mock('@/lib/supabase/blocchi', async (vero) => ({
  ...(await vero<typeof import('@/lib/supabase/blocchi')>()),
  // Le recensioni ricevute: due, da 5 e da 4 stelle.
  leggiTutteLeRighe: async () => ({
    data: [
      { id: 'r1', rating: 5, comment: 'Puntuale', created_at: '2026-11-20T10:00:00Z', autore_nome: 'Anna' },
      { id: 'r2', rating: 4, comment: null, created_at: '2026-11-19T10:00:00Z', autore_nome: 'Bruno' },
    ],
    error: null,
    troncato: false,
  }),
}));
vi.mock('@/lib/supabase/client', () => {
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'profiles') return { data: { rider_is_online: true, rider_zones: [] }, error: null };
      if (tavola === 'rider_reviews') return { data: [{ rating: 5 }, { rating: 4 }], error: null };
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'gte', 'limit', 'range']) c[m] = () => c;
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
const { default: Recensioni } = await import('@/app/rider/reviews/page');

let radice: Root | null = null;
let div: HTMLDivElement | null = null;

const gira = async (volte = 10) => {
  for (let i = 0; i < volte; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
};

async function accendi(Pagina: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => {
    radice!.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never)));
  });
  await gira();
  return div;
}

const testo = (d: HTMLElement) => (d.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.unstubAllGlobals();
});

describe('R11-003 · il voto del fattorino si dice in italiano', () => {
  it('sulla bacheca la terza casella di oggi è «Voto» col suo numero, non «Rating»', async () => {
    const d = await accendi(Bacheca);
    // Le tre caselle di oggi: un numero in grassetto e, sotto, l'etichetta in maiuscoletto.
    const caselle = Array.from(d.querySelectorAll('p.uppercase'))
      .map((p) => ({ etichetta: (p.textContent ?? '').trim(), valore: (p.previousElementSibling?.textContent ?? '').trim() }))
      .filter((c) => ['Oggi', 'Consegne', 'Voto', 'Rating'].includes(c.etichetta));
    expect(caselle.map((c) => c.etichetta), 'una casella della bacheca parla inglese').toEqual(['Oggi', 'Consegne', 'Voto']);
    expect(caselle.find((c) => c.etichetta === 'Voto')?.valore).toBe('4,5');
    expect(testo(d)).not.toMatch(/\brating\b/i);
  }, 30000);

  it('nelle recensioni il consiglio è «Come migliorare il voto»', async () => {
    const d = await accendi(Recensioni);
    expect(testo(d)).toMatch(/Come migliorare il voto/);
    expect(testo(d), 'la pagina delle recensioni del fattorino parla inglese').not.toMatch(/\brating\b/i);
  }, 30000);
});
