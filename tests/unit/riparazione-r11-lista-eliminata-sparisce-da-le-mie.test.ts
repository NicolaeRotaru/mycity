/**
 * @vitest-environment jsdom
 *
 * R11-009 — Dalla pagina di una lista (/lists/[id]) chi l'ha creata la elimina, e la pagina lo porta
 * su /lists. Lì «Le mie liste» si disegnava dalla memoria, che teneva ancora la lista eliminata:
 * l'invalidazione la segna vecchia e la fa rileggere, ma finché la rilettura non torna la lista c'è,
 * e toccarla porta a «Lista non trovata».
 *
 * Qui /lists e la pagina della lista stanno nello stesso QueryClient vero (con i 30 secondi di
 * «fresco» del sito), sopra un database finto in memoria. Si apre /lists, si apre la lista, la si
 * elimina, e si torna su /lists con il database che risponde con calma: si guarda cosa c'è a video
 * PRIMA che la rilettura torni.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({
  liste: [] as Array<Record<string, unknown>>,
  righe: [] as Array<Record<string, unknown>>,
  ritardo: 0,
  letture: 0,
}));

vi.mock('@/lib/supabase/client', () => {
  function domanda(tabella: string) {
    const filtri: Array<[string, unknown]> = [];
    let operazione: 'select' | 'delete' = 'select';
    let una = false;
    const passa = (r: Record<string, unknown>) => filtri.every(([k, v]) => r[k] === v);
    const esegui = () => {
      if (tabella === 'product_list_items') return { data: db.righe.filter(passa), error: null };
      if (operazione === 'delete') {
        db.liste = db.liste.filter((l) => !passa(l));
        return { data: null, error: null };
      }
      // Le letture di «Le mie liste»: quelle filtrate per chi le ha create.
      if (filtri.some(([k]) => k === 'owner_id')) db.letture += 1;
      const righe = db.liste.filter(passa).map((l) => ({ ...l, items_count: [{ count: 0 }] }));
      return { data: una ? (righe[0] ?? null) : righe, error: null };
    };
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.limit = () => c;
    c.eq = (k: string, v: unknown) => { filtri.push([k, v]); return c; };
    c.in = () => c;
    c.delete = () => { operazione = 'delete'; return c; };
    c.maybeSingle = () => { una = true; return c; };
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (operazione === 'select' && db.ritardo) {
        return new Promise((r) => setTimeout(r, db.ritardo)).then(() => esegui()).then(ok, ko);
      }
      return Promise.resolve(esegui()).then(ok, ko);
    };
    return c;
  }
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-maria' } } }) },
      from: (t: string) => domanda(t),
      rpc: async () => ({ data: [], error: null }),
    },
  };
});
vi.mock('@/lib/queries/profili-pubblici', () => ({
  conAutoriPubblici: async (liste: Array<Record<string, unknown>>) => liste.map((l) => ({ ...l, owner: null })),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// React 18 non ha ancora `use`: la pagina lo usa per i parametri, che qui arrivano già pronti.
vi.mock('react', async (originale) => ({ ...(await originale<Record<string, unknown>>()), use: (v: unknown) => v }));
vi.mock('next/link', () => import('./aiuti/finti/next-link.mjs'));
vi.mock('next/image', () => import('./aiuti/finti/next-image.mjs'));
vi.mock('next/navigation', () => import('./aiuti/finti/next-navigation.mjs'));
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));

import ListsPage from '@/app/lists/page';
import ListDetailPage from '@/app/lists/[id]/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Liste private: le vede solo chi le ha create, in «Le mie liste».
const COLAZIONE = {
  id: 'L1', owner_id: 'u-maria', title: 'Colazione', description: null, cover_emoji: null,
  is_public: false, is_featured: false, updated_at: '2026-11-02T10:00:00Z',
};
const MERENDA = { ...COLAZIONE, id: 'L2', title: 'Merenda', updated_at: '2026-11-01T10:00:00Z' };

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  db.ritardo = 0;
  db.letture = 0;
  document.body.innerHTML = '';
});

async function aspetta(cond: () => boolean, cosa: string) {
  await vi.waitFor(() => { expect(cond(), cosa).toBe(true); }, { timeout: 3000, interval: 10 });
}

const pausa = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

function monta(qc: QueryClient, figlio: ReturnType<typeof createElement>): HTMLDivElement {
  const box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(createElement(QueryClientProvider, { client: qc }, figlio)); });
  return box;
}

async function smonta() {
  await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
}

describe('R11-009 · eliminata una lista, «Le mie liste» non la mostra più', () => {
  it('tornando su /lists la lista eliminata non c’è nemmeno prima che la rilettura torni', async () => {
    db.liste = [{ ...COLAZIONE }, { ...MERENDA }];
    db.righe = [];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });

    // 1. /lists: le mie liste ci sono tutte e due.
    let box = monta(qc, createElement(ListsPage));
    await aspetta(() => box.querySelector('a[href="/lists/L1"]') !== null && box.querySelector('a[href="/lists/L2"]') !== null,
      '/lists non mostra le due liste di chi le ha create');
    await smonta();

    // 2. La pagina della lista: la si elimina.
    box = monta(qc, createElement(ListDetailPage as never, { params: { id: 'L1' } }));
    const cestino = () => box.querySelector('button[aria-label="Elimina"]') as HTMLButtonElement | null;
    await aspetta(() => cestino() !== null, 'la pagina della lista non offre «Elimina» a chi l’ha creata');
    await act(async () => { cestino()!.click(); });
    await aspetta(() => !db.liste.some((l) => l.id === 'L1'), 'l’eliminazione non è arrivata al database');
    await pausa(20);
    await smonta();

    // 3. Di nuovo su /lists, col database lento: si guarda subito, prima che la rilettura torni.
    db.ritardo = 400;
    const lettePrima = db.letture;
    box = monta(qc, createElement(ListsPage));
    await pausa(30);
    expect(box.querySelector('a[href="/lists/L2"]'), 'le altre liste dalla memoria devono restare a video').not.toBeNull();
    expect(box.querySelector('a[href="/lists/L1"]'),
      '«Le mie liste» mostra ancora la lista eliminata: toccarla porta a «Lista non trovata»').toBeNull();

    // E le mie liste si rileggono lo stesso: la memoria non è diventata «fresca» per 30 secondi.
    await pausa(500);
    expect(db.letture, 'dopo l’eliminazione /lists non rilegge «Le mie liste»').toBeGreaterThan(lettePrima);
    expect(box.querySelector('a[href="/lists/L1"]')).toBeNull();
    expect(box.querySelector('a[href="/lists/L2"]')).not.toBeNull();
  });
});
