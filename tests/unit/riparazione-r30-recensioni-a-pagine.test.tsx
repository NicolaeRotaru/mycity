/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R30-007 — la linguetta dice «Recensioni · 45» e la vetrina ne legge 20. Arrivati in fondo alle
 * 20, «Mostra altre recensioni» deve leggere le altre a pagine, con la stessa lettura della vetrina
 * (stesse colonne, stesso ordine, nomi dalla vista dei nomi pubblici), fino al conto vero.
 * Il database è finto: 45 recensioni, la più nuova per prima.
 */

const stato = vi.hoisted(() => ({
  richieste: [] as Array<{ tabella: string; colonne: string; filtri: unknown[][]; ordine: unknown[]; da: number; a: number }>,
  rotta: false,
}));

const TUTTE = Array.from({ length: 45 }, (_, i) => ({
  id: `rv-${i + 1}`,
  rating: 5,
  comment: `Recensione numero ${i + 1}`,
  created_at: new Date(Date.UTC(2026, 10, 15) - i * 3_600_000).toISOString(),
  seller_reply: null,
  user_id: `u-${i + 1}`,
  order_id: null,
  photo_urls: null,
  helpful_count: 0,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (tabella: string) => {
      const r = { tabella, colonne: '', filtri: [] as unknown[][], ordine: [] as unknown[], da: -1, a: -1 };
      const catena = {
        select: (colonne: string) => { r.colonne = colonne; return catena; },
        eq: (...f: unknown[]) => { r.filtri.push(f); return catena; },
        in: () => catena,
        order: (...o: unknown[]) => { r.ordine = o; return catena; },
        range: (da: number, a: number) => {
          r.da = da; r.a = a;
          stato.richieste.push(r);
          if (stato.rotta) return Promise.resolve({ data: null, error: { message: 'rete' } });
          return Promise.resolve({ data: TUTTE.slice(da, a + 1), error: null });
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return catena;
    },
  },
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({
  fetchNomiPubblici: async (_s: unknown, ids: Array<string | null>) =>
    new Map(ids.filter((i): i is string => !!i).map((i) => [i, `Nome di ${i}`])),
}));
vi.mock('@/components/Segnala', () => ({ Segnala: () => null }));
vi.mock('@/components/hooks/useUtente', () => ({ useUtente: () => ({ userId: null }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/image', () => ({ default: () => null }));

import ReviewsSection from '@/components/store-sections/ReviewsSection';

/** Le prime 20, come le legge la vetrina (useStorePageData), già con il nome. */
const PRIME = TUTTE.slice(0, 20).map((r) => ({ ...r, author: `Nome di ${r.user_id}` }));

let radice: Root;
let box: HTMLDivElement;
beforeEach(() => {
  stato.richieste.length = 0;
  stato.rotta = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement('div');
  document.body.appendChild(box);
  radice = createRoot(box);
});
afterEach(() => {
  act(() => radice.unmount());
  box.remove();
});

async function monta(ctx: Record<string, unknown>) {
  await act(async () => {
    radice.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ReviewsSection, { ctx: ctx as never })));
  });
}
const voci = () => box.querySelectorAll('li').length;
const bottone = () => [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Mostra altre recensioni')) ?? null;
async function premi() {
  const b = bottone();
  expect(b, 'il bottone «Mostra altre recensioni» non c’è').not.toBeNull();
  await act(async () => { b!.click(); });
  await act(async () => { await Promise.resolve(); });
}

const CTX = { storeId: 'negozio-1', reviews: PRIME, accent: '#7A8B3C', recensioniInErrore: false, riepilogoRecensioni: { media: 5, totale: 45 } };

describe('R30-007 — le recensioni oltre le prime 20 si leggono a pagine', () => {
  it('con 45 nel database si arriva a leggerle tutte e 45', async () => {
    await monta(CTX);
    expect(voci()).toBe(6);
    expect(bottone()?.textContent).toContain('(39)');

    // Prima le 14 già lette dalla vetrina: nessuna richiesta.
    await premi();
    expect(voci()).toBe(20);
    expect(stato.richieste).toHaveLength(0);
    expect(bottone()?.textContent, 'arrivati a 20 su 45 non c’è modo di leggere le altre').toContain('(25)');

    // Poi le altre, venti alla volta, con la stessa lettura della vetrina.
    await premi();
    expect(voci()).toBe(40);
    expect(stato.richieste).toHaveLength(1);
    const [prima] = stato.richieste;
    expect(prima.tabella).toBe('store_reviews');
    expect(prima.colonne).toBe('id, rating, comment, created_at, seller_reply, user_id, order_id, photo_urls, helpful_count');
    expect(prima.filtri).toEqual([['store_id', 'negozio-1']]);
    expect(prima.ordine).toEqual(['created_at', { ascending: false }]);
    expect([prima.da, prima.a]).toEqual([20, 39]);
    expect(box.textContent).toContain('Recensione numero 40');
    expect(box.textContent).toContain('Nome di u-40');
    expect(bottone()?.textContent).toContain('(5)');

    await premi();
    expect(voci()).toBe(45);
    expect([stato.richieste[1].da, stato.richieste[1].a]).toEqual([40, 59]);
    expect(bottone(), 'lette tutte e 45: il bottone non serve più').toBeNull();
  });

  it('senza il conto vero non promette altre recensioni oltre quelle lette', async () => {
    await monta({ ...CTX, riepilogoRecensioni: null });
    await premi();
    expect(voci()).toBe(20);
    expect(bottone()).toBeNull();
    expect(stato.richieste).toHaveLength(0);
  });

  it('una lettura che cade non toglie le recensioni già lette, e si può riprovare', async () => {
    await monta(CTX);
    await premi();
    stato.rotta = true;
    await premi();
    expect(voci()).toBe(20);
    expect(bottone()?.textContent).toContain('(25)');
    stato.rotta = false;
    await premi();
    expect(voci()).toBe(40);
  });
});
