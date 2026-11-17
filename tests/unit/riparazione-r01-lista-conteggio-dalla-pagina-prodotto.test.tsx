/**
 * @vitest-environment jsdom
 *
 * Aggiungere o togliere un prodotto da una lista dalla pagina prodotto lasciava vecchio il
 * conteggio «N prodotti» in /lists: il pulsante rileggeva solo le sue chiavi (in quali liste
 * c'è il prodotto, i prodotti delle liste), non quelle da cui /lists legge le liste col loro
 * conteggio. Qui /lists e il pulsante stanno nello stesso QueryClient vero, sopra un database
 * finto in memoria: si aggiunge, si toglie, e si guarda il numero che /lists mostra.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Lista = { id: string; owner_id: string; title: string; description: null; cover_emoji: null; is_public: boolean; is_featured: boolean; updated_at: string };
const db = vi.hoisted(() => ({
  liste: [] as Array<Record<string, unknown>>,
  righe: [] as Array<{ list_id: string; product_id: string }>,
}));

vi.mock('@/lib/supabase/client', () => {
  function domanda(tabella: string) {
    const filtri: Array<[string, unknown]> = [];
    const dentro: Array<[string, unknown[]]> = [];
    let operazione: 'select' | 'insert' | 'delete' = 'select';
    let daInserire: Record<string, unknown> | null = null;
    const esegui = () => {
      const passa = (r: Record<string, unknown>) =>
        filtri.every(([k, v]) => r[k] === v) && dentro.every(([k, vs]) => vs.includes(r[k]));
      if (tabella === 'product_list_items') {
        if (operazione === 'insert') { db.righe.push(daInserire as never); return { data: null, error: null }; }
        if (operazione === 'delete') { db.righe = db.righe.filter((r) => !passa(r)); return { data: null, error: null }; }
        return { data: db.righe.filter(passa), error: null };
      }
      const righe = db.liste.filter(passa).map((l) => ({
        ...l,
        items_count: [{ count: db.righe.filter((r) => r.list_id === l.id).length }],
      }));
      return { data: righe, error: null };
    };
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.limit = () => c;
    c.eq = (k: string, v: unknown) => { filtri.push([k, v]); return c; };
    c.in = (k: string, vs: unknown[]) => { dentro.push([k, vs]); return c; };
    c.insert = (v: Record<string, unknown>) => { operazione = 'insert'; daInserire = v; return c; };
    c.delete = () => { operazione = 'delete'; return c; };
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko);
    return c;
  }
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-maria' } } }) },
      from: (t: string) => domanda(t),
    },
  };
});
vi.mock('@/lib/queries/profili-pubblici', () => ({
  conAutoriPubblici: async (liste: Array<Record<string, unknown>>) => liste.map((l) => ({ ...l, owner: null })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));

import ListsPage from '@/app/lists/page';
import AddToListButton from '@/components/AddToListButton';

const COLAZIONE: Lista = {
  id: 'L1', owner_id: 'u-maria', title: 'Colazione', description: null, cover_emoji: null,
  is_public: true, is_featured: true, updated_at: '2026-11-01T10:00:00Z',
};

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** I conteggi che /lists mostra sotto ogni scheda (le mie, in vetrina, pubbliche). */
const conteggi = (box: HTMLElement) =>
  [...box.querySelectorAll('a[href="/lists/L1"] p')].map((p) => (p.textContent ?? '').trim());

async function aspetta(cond: () => boolean, cosa: string) {
  await vi.waitFor(() => { expect(cond(), cosa).toBe(true); }, { timeout: 3000, interval: 10 });
}

async function scena() {
  db.liste = [{ ...COLAZIONE }];
  db.righe = [{ list_id: 'L1', product_id: 'p-pane' }];
  const box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(createElement(QueryClientProvider, { client: qc },
      createElement('div', null, createElement(ListsPage), createElement(AddToListButton, { productId: 'p-focaccia' }))));
  });
  await aspetta(() => conteggi(box).length === 3, '/lists non ha ancora disegnato la lista nelle tre sezioni');
  expect(conteggi(box)).toEqual(['1 prodotto', '1 prodotto', '1 prodotto']);
  const avvio = [...box.querySelectorAll('button')].find((b) => /Aggiungi a lista/.test(b.textContent ?? ''))!;
  await act(async () => { avvio.click(); });
  const voce = () => [...box.querySelectorAll('li button')].find((b) => (b.textContent ?? '').includes('Colazione')) as HTMLButtonElement | undefined;
  await aspetta(() => voce()?.getAttribute('aria-pressed') === 'false', 'la lista Colazione non è ancora nel pannello');
  return { box, voce: () => voce()! };
}

describe('dalla pagina prodotto il conteggio in /lists segue le aggiunte e le rimozioni', () => {
  it('dopo l’aggiunta /lists dice 2 prodotti, dopo la rimozione torna a 1', async () => {
    const { box, voce } = await scena();

    await act(async () => { voce().click(); });
    await aspetta(() => db.righe.length === 2, 'l’aggiunta non è arrivata al database');
    await aspetta(() => conteggi(box).every((t) => t === '2 prodotti'),
      `dopo l’aggiunta /lists resta vecchio: ${JSON.stringify(conteggi(box))}`);

    await aspetta(() => voce().getAttribute('aria-pressed') === 'true', 'il pannello non sa ancora che il prodotto è nella lista');
    await act(async () => { voce().click(); });
    await aspetta(() => db.righe.length === 1, 'la rimozione non è arrivata al database');
    await aspetta(() => conteggi(box).every((t) => t === '1 prodotto'),
      `dopo la rimozione /lists resta vecchio: ${JSON.stringify(conteggi(box))}`);
  });
});
