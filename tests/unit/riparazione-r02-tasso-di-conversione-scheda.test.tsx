/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R02-008 — Il «conversion rate» del negozio poteva superare il 100% e veniva colorato di verde.
 * Gli ordini sono di tutti, le visite solo di chi accetta i cookie (lib/analytics/visita-prodotto.ts):
 * il rapporto è gonfiato. Oltre il 100% non si mostrava più, ma restavano due casi:
 *  · tanti ordini quante visite misurate: «100,0%» in verde, cioè «compra chiunque guardi»;
 *  · zero visite misurate con ordini veri (al lancio, se nessuno accetta i cookie): la scheda diceva
 *    «Serve il conto delle visite per calcolarlo» accanto a una scheda Visite che mostra 0.
 *
 * Qui la pagina VERA «Analisi» (app/seller/analytics/page.tsx) con un database finto.
 */
const mondo = vi.hoisted(() => ({
  visite: 0 as number,
  visiteRotte: false,
  ordini: 0,
}));

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }), usePathname: () => '/seller/analytics' }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/lib/supabase/client', () => {
  const ordini = () => Array.from({ length: mondo.ordini }, (_, i) => ({
    id: `o${i}`, total_price: 10, delivery_status: 'DELIVERED', payment_status: 'PAID', application_fee_cents: 100,
    shipping_cost: 0, delivery_fee_cents: 300, refunded_amount_cents: 0, wallet_applied_cents: 0,
    seller_payout_cents: 900, seller_payout_reversed_cents: 0, created_at: '2026-11-20T10:00:00Z',
  }));
  const catena = (finale: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'order', 'in']) c[m] = () => c;
    c.then = (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(finale()).then(ok, ko);
    return c;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'neg-1' } } }) },
      from: (tavola: string) => {
        if (tavola === 'products') {
          return catena(() => ({ data: [{ id: 'p1', name: 'Pane', price: 4, images: [], status: 'available', stock: 5, created_at: '2026-10-01T00:00:00Z' }], error: null }));
        }
        if (tavola === 'orders') return catena(() => ({ data: ordini(), error: null }));
        return catena(() => ({ data: [], error: null }));
      },
      rpc: async (nome: string) => {
        if (nome !== 'andamento_del_negozio') return { data: null, error: { message: 'sconosciuta' } };
        if (mondo.visiteRotte) return { data: null, error: { message: 'function andamento_del_negozio() missing' } };
        return {
          data: [{ viste_30: mondo.visite, viste_7: mondo.visite, viste_oggi: 0, viste_per_prodotto: { p1: mondo.visite }, voto_medio: null, recensioni: 0 }],
          error: null,
        };
      },
    },
  };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let div: HTMLDivElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  div.remove();
  mondo.visiteRotte = false;
});

async function apri(ordini: number, visite: number) {
  mondo.ordini = ordini;
  mondo.visite = visite;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  const { default: Pagina } = await import('@/app/seller/analytics/page');
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Pagina))); });
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  vi.useRealTimers();
}

/** La scheda «Visite che diventano ordini»: valore, riga sotto e colore dell'icona. */
function laScheda() {
  const etichetta = [...div.querySelectorAll('p')].find((p) => p.textContent === 'Visite che diventano ordini');
  expect(etichetta, 'la scheda del tasso non è a video').toBeTruthy();
  const scheda = etichetta!.parentElement!;
  const [, valore, riga] = [...scheda.querySelectorAll('p')];
  return {
    valore: valore?.textContent ?? '',
    riga: riga?.textContent ?? '',
    verde: (scheda.firstElementChild?.className ?? '').includes('bg-olive-100'),
  };
}

describe('R02-008 · il tasso del negozio non dice cose impossibili, e non le colora di verde', () => {
  it('controprova: 4 ordini su 200 visite misurate sono il 2,0%, in verde come prima', async () => {
    await apri(4, 200);
    const s = laScheda();
    expect(s.valore).toBe('2,0%');
    expect(s.riga).toBe('su 200 visite misurate');
    expect(s.verde).toBe(true);
  });

  it('5 ordini su 5 visite misurate: niente «100,0%» in verde, il campione è troppo piccolo', async () => {
    await apri(5, 5);
    const s = laScheda();
    expect(s.valore, '«100,0%»: compra chiunque guardi').toBe('—');
    expect(s.verde).toBe(false);
    expect(s.riga).toBe('Campione troppo piccolo: 5 ordini su 5 visite misurate');
  });

  it('3 ordini e zero visite misurate (nessuno ha accettato i cookie): campione troppo piccolo, non «serve il conto»', async () => {
    await apri(3, 0);
    const s = laScheda();
    expect(s.valore).toBe('—');
    expect(s.verde).toBe(false);
    expect(s.riga).toBe('Campione troppo piccolo: 3 ordini su 0 visite misurate');
  });

  it('se le visite non si leggono, il tasso resta «non lo so»', async () => {
    mondo.visiteRotte = true;
    await apri(3, 0);
    const s = laScheda();
    expect(s.valore).toBe('—');
    expect(s.riga).toBe('Serve il conto delle visite per calcolarlo');
  });
});
