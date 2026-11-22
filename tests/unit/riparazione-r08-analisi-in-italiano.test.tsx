/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 21/11/2026 (R08) — LA PAGINA «ANALISI» DEL NEGOZIO PARLA ITALIANO.
 *
 * In palestra (8/11) la pagina mostrava «INSIGHT», «RATING MEDIO», «30GG» e, fra i consigli,
 * «tieni lo stock pronto»: un fornaio capisce poco le parole inglesi. Qui la pagina VERA
 * (app/seller/analytics/page.tsx) si monta con un database finto e si legge quello che è a video.
 */
// Il nome del prodotto più visto e l'interruttore delle sponsorizzazioni, che le prove possono cambiare:
// il titolo di riserva del consiglio «Spingi …» si vede solo con le sponsorizzazioni accese e un
// prodotto senza nome.
const scena = vi.hoisted(() => ({ nomeProdotto: 'Pane' as string | null, sponsorizzazioni: false }));
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  get ABBONAMENTO_NEGOZI_ACCESO() { return scena.sponsorizzazioni; },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }), usePathname: () => '/seller/analytics' }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/lib/supabase/client', () => {
  const ordini = Array.from({ length: 4 }, (_, i) => ({
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
          return catena(() => ({ data: [{ id: 'p1', name: scena.nomeProdotto, price: 4, images: [], status: 'available', stock: 5, created_at: '2026-10-01T00:00:00Z' }], error: null }));
        }
        if (tavola === 'orders') return catena(() => ({ data: ordini, error: null }));
        return catena(() => ({ data: [], error: null }));
      },
      rpc: async (nome: string) => {
        if (nome !== 'andamento_del_negozio') return { data: null, error: { message: 'sconosciuta' } };
        return {
          data: [{ viste_30: 3, viste_7: 3, viste_oggi: 0, viste_per_prodotto: { p1: 3 }, voto_medio: 4.5, recensioni: 2 }],
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
  scena.nomeProdotto = 'Pane';
  scena.sponsorizzazioni = false;
});

async function apri(): Promise<string> {
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
  return (div.textContent ?? '').replace(/\s+/g, ' ');
}

describe('R08 · le etichette della pagina Analisi sono in italiano', () => {
  it('niente «Insight», «Rating medio», «30gg», «stock pronto»', async () => {
    const testo = await apri();
    expect(testo, 'la pagina non si è disegnata').toContain('Analisi');
    expect(testo).not.toMatch(/Insight/);
    expect(testo).not.toMatch(/Rating medio/i);
    expect(testo).not.toMatch(/30\s?gg/i);
    expect(testo).not.toMatch(/stock pronto/i);
  });

  it('al loro posto «Consigli», «Voto medio», «30 giorni», «tieni pronta la merce»', async () => {
    const testo = await apri();
    expect(testo).toContain('Voto medio');
    expect(testo).toContain('Visite (30 giorni)');
    expect(testo).toContain('Ordini (30 giorni)');
    expect(testo).toContain('tieni pronta la merce');
    expect(testo).toMatch(/Consigli/);
  });

  it('niente «7gg»: le visite e gli ordini della settimana dicono «ultimi 7 giorni»', async () => {
    const testo = await apri();
    expect(testo).not.toMatch(/7\s?gg/i);
    expect(testo).toContain('0 oggi · 3 ultimi 7 giorni');
    expect(testo).toContain('4 ultimi 7 giorni');
  });

  it('il consiglio sul prodotto senza nome dice «il tuo prodotto più venduto», non «best-seller»', async () => {
    scena.nomeProdotto = null;
    scena.sponsorizzazioni = true;
    const testo = await apri();
    expect(testo).not.toMatch(/best-?seller/i);
    expect(testo).toContain('Spingi "il tuo prodotto più venduto"');
  });
});
