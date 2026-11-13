/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R20-004 — La bacheca del fattorino mostrava «Oggi 0,00 €» e «0 consegne» quando la lettura degli
 * incassi del giorno cadeva (l'errore diventava una lista vuota) e mentre caricava. È il numero su
 * cui il fattorino decide se continuare il turno: un guasto non deve sembrare una giornata a zero.
 *
 * La pagina si monta col react-query vero; la lettura dei consegnati di oggi cade, resta in volo,
 * oppure risponde.
 */

const mondo = vi.hoisted(() => ({
  oggi: 'risponde' as 'risponde' | 'cade' | 'in-volo',
  /** 'giu': supabase.auth.getUser() risponde «nessun utente» con l'errore di rete (AuthRetryableFetchError). */
  rete: 'su' as 'su' | 'giu',
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
vi.mock('@/lib/supabase/client', () => {
  const catena = (tavola: string) => {
    let colonne = '';
    const risposta = (): Promise<{ data: unknown; error: unknown }> => {
      if (tavola === 'orders' && colonne.includes('delivered_at')) {
        if (mondo.oggi === 'in-volo') return new Promise(() => {});
        if (mondo.oggi === 'cade') return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } });
        return Promise.resolve({
          data: [
            { shipping_cost: 3, rider_fee_cents: 300, delivered_at: '2026-11-13T09:00:00Z' },
            { shipping_cost: 3, rider_fee_cents: 300, delivered_at: '2026-11-13T09:30:00Z' },
          ],
          error: null,
        });
      }
      if (tavola === 'profiles') return Promise.resolve({ data: { rider_is_online: true, rider_zones: [] }, error: null });
      return Promise.resolve({ data: [], error: null });
    };
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'order', 'gte', 'update', 'limit']) c[m] = () => c;
    c.select = (cols: string) => { colonne = cols ?? ''; return c; };
    c.single = () => risposta();
    c.maybeSingle = () => risposta();
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => risposta().then(ok, ko);
    return c;
  };
  return {
    supabase: {
      from: catena,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: async () =>
          mondo.rete === 'giu'
            ? { data: { user: null }, error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }) }
            : { data: { user: { id: 'luca' } }, error: null },
      },
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

/** Il numero scritto sopra l'etichetta del riquadro («Oggi», «Consegne»). */
const valoreDi = (d: HTMLElement, etichetta: string) => {
  const p = Array.from(d.querySelectorAll('p')).find((x) => (x.textContent ?? '').trim() === etichetta);
  return (p?.previousElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mondo.oggi = 'risponde';
  mondo.rete = 'su';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  vi.unstubAllGlobals();
});

describe('R20-004 — «Oggi» e «Consegne» sulla bacheca del fattorino', () => {
  it('controllo: con la lettura riuscita mostra il compenso e le consegne del giorno', async () => {
    const d = await accendi();
    expect(valoreDi(d, 'Oggi'), 'il riquadro «Oggi» non si trova: la prova girerebbe a vuoto').toMatch(/6,00/);
    expect(valoreDi(d, 'Consegne')).toBe('2');
  }, 30000);

  it('con la lettura caduta non dice «0,00 €» e «0»', async () => {
    mondo.oggi = 'cade';
    const d = await accendi();
    expect(valoreDi(d, 'Oggi'), 'un guasto della lettura sembra una giornata a zero euro').not.toMatch(/0,00/);
    expect(valoreDi(d, 'Oggi')).toBe('—');
    expect(valoreDi(d, 'Consegne'), 'un guasto della lettura sembra una giornata senza consegne').toBe('—');
  }, 30000);

  it('mentre carica non dice «0,00 €» e «0»', async () => {
    mondo.oggi = 'in-volo';
    const d = await accendi();
    expect(valoreDi(d, 'Oggi'), 'durante il caricamento la giornata sembra a zero euro').toBe('—');
    expect(valoreDi(d, 'Consegne')).toBe('—');
  }, 30000);

  // Giro di correzione: senza rete getUser() dà «nessun utente» con un errore, e la lettura
  // «riusciva» a zero. Aperta la bacheca senza rete, tornata la rete, i riquadri restavano a zero.
  it('aperta senza rete: col «Riprova» e la rete tornata mostra il compenso vero, non 0,00 €', async () => {
    mondo.rete = 'giu';
    const d = await accendi();
    const riprova = d.querySelector<HTMLButtonElement>('[role="alert"] button');
    expect(riprova, 'senza rete la bacheca dovrebbe mostrare il «Riprova»: la prova girerebbe a vuoto').not.toBeNull();
    mondo.rete = 'su';
    await act(async () => { riprova!.click(); });
    await gira();
    expect(valoreDi(d, 'Oggi'), 'tornata la rete i riquadri restano a zero: la lettura di oggi non si rilegge').toMatch(/6,00/);
    expect(valoreDi(d, 'Consegne')).toBe('2');
  }, 30000);

  it('aperta senza rete: quando la rete torna rilegge gli incassi di oggi, non resta a 0,00 €', async () => {
    mondo.rete = 'giu';
    const d = await accendi();
    mondo.rete = 'su';
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
    });
    await gira();
    expect(valoreDi(d, 'Oggi'), 'tornata la rete i riquadri restano a zero: senza utente la lettura «riusciva» a zero').toMatch(/6,00/);
    expect(valoreDi(d, 'Consegne')).toBe('2');
  }, 30000);
});
