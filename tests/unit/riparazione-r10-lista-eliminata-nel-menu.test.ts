/**
 * @vitest-environment jsdom
 *
 * R10-009 — Dalla pagina di una lista (/lists/[id]) chi l'ha creata la elimina. Dopo, la pagina
 * rileggeva le chiavi di /lists ma non quella del menu «Aggiungi a lista» della scheda prodotto:
 * riaprendo il menu, la lista eliminata c'era ancora (e toccandola si provava a scriverci dentro)
 * finché la chiave non scadeva.
 *
 * Qui il pulsante della scheda prodotto e la pagina della lista stanno nello stesso QueryClient
 * vero (con i 30 secondi di «fresco» del sito), sopra un database finto in memoria: si apre il
 * menu, lo si chiude, si elimina la lista e si riapre il menu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({
  liste: [] as Array<Record<string, unknown>>,
  righe: [] as Array<{ list_id: string; product_id: string }>,
  /** Millisecondi di attesa di ogni risposta del database finto (0 = subito). */
  ritardo: 0,
}));

vi.mock('@/lib/supabase/client', () => {
  function domanda(tabella: string) {
    const filtri: Array<[string, unknown]> = [];
    let operazione: 'select' | 'update' | 'delete' = 'select';
    let modifica: Record<string, unknown> = {};
    let una = false;
    const passa = (r: Record<string, unknown>) => filtri.every(([k, v]) => r[k] === v);
    const esegui = () => {
      if (tabella === 'product_list_items') return { data: db.righe.filter(passa as never), error: null };
      if (operazione === 'update') {
        db.liste = db.liste.map((l) => (passa(l) ? { ...l, ...modifica } : l));
        return { data: null, error: null };
      }
      if (operazione === 'delete') {
        db.liste = db.liste.filter((l) => !passa(l));
        return { data: null, error: null };
      }
      const righe = db.liste.filter(passa).map((l) => ({
        ...l,
        items_count: [{ count: db.righe.filter((r) => r.list_id === l.id).length }],
      }));
      return { data: una ? (righe[0] ?? null) : righe, error: null };
    };
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.limit = () => c;
    c.eq = (k: string, v: unknown) => { filtri.push([k, v]); return c; };
    c.in = () => c;
    c.update = (v: Record<string, unknown>) => { operazione = 'update'; modifica = v; return c; };
    c.delete = () => { operazione = 'delete'; return c; };
    c.maybeSingle = () => { una = true; return c; };
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      (db.ritardo
        ? new Promise((r) => setTimeout(r, db.ritardo)).then(() => esegui())
        : Promise.resolve(esegui())
      ).then(ok, ko);
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
// React 18 non ha ancora `use`: la pagina lo usa per i parametri, che qui arrivano già pronti.
vi.mock('react', async (originale) => ({ ...(await originale<Record<string, unknown>>()), use: (v: unknown) => v }));
vi.mock('next/link', () => import('./aiuti/finti/next-link.mjs'));
vi.mock('next/image', () => import('./aiuti/finti/next-image.mjs'));
vi.mock('next/navigation', () => import('./aiuti/finti/next-navigation.mjs'));
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));

import { toast } from 'sonner';
import AddToListButton from '@/components/AddToListButton';
import ListDetailPage from '@/app/lists/[id]/page';

const COLAZIONE = {
  id: 'L1', owner_id: 'u-maria', title: 'Colazione', description: null, cover_emoji: null,
  is_public: true, is_featured: false, updated_at: '2026-11-01T10:00:00Z',
};

let root: Root | null = null;
afterEach(() => {
  db.ritardo = 0;
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function aspetta(cond: () => boolean, cosa: string) {
  await vi.waitFor(() => { expect(cond(), cosa).toBe(true); }, { timeout: 3000, interval: 10 });
}

describe('dopo l’eliminazione di una lista, il menu «Aggiungi a lista» non la mostra più', () => {
  it('riaprendo il menu della scheda prodotto la lista eliminata non c’è', async () => {
    db.liste = [{ ...COLAZIONE }];
    db.righe = [];
    const box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    await act(async () => {
      root!.render(createElement(QueryClientProvider, { client: qc },
        createElement('div', null,
          createElement(AddToListButton, { productId: 'p-focaccia' }),
          createElement(ListDetailPage as never, { params: { id: 'L1' } }))));
    });

    const menu = () => box.querySelector('[role="dialog"]') as HTMLElement | null;
    const avvio = () => [...box.querySelectorAll('button')].find((b) => /Aggiungi a lista/.test(b.textContent ?? '')) as HTMLButtonElement;
    const voceColazione = () => [...(menu()?.querySelectorAll('li button') ?? [])].find((b) => (b.textContent ?? '').includes('Colazione'));

    // Il menu si apre e mostra la lista; poi si chiude.
    await act(async () => { avvio().click(); });
    await aspetta(() => voceColazione() !== undefined, 'la lista Colazione non è nel menu: la prova non guarda niente');
    await act(async () => { (menu()!.querySelector('button[aria-label="Chiudi"]') as HTMLButtonElement).click(); });
    expect(menu()).toBeNull();

    // Si elimina la lista dalla sua pagina.
    const cestino = () => box.querySelector('button[aria-label="Elimina"]') as HTMLButtonElement | null;
    await aspetta(() => cestino() !== null, 'la pagina della lista non offre «Elimina» a chi l’ha creata');
    await act(async () => { cestino()!.click(); });
    await aspetta(() => db.liste.length === 0, 'l’eliminazione non è arrivata al database');

    // Si riapre il menu: la lista eliminata non c’è più.
    await act(async () => { avvio().click(); });
    await aspetta(() => menu() !== null && voceColazione() === undefined && /Non hai ancora liste/.test(menu()!.textContent ?? ''),
      'dopo l’eliminazione il menu «Aggiungi a lista» mostra ancora la lista Colazione');
  });
  it('con la rete lenta, riaperto il menu subito dopo l’eliminazione la lista eliminata non c’è già', async () => {
    db.liste = [{ ...COLAZIONE }];
    db.righe = [];
    db.ritardo = 150;
    vi.mocked(toast.success).mockClear();
    const box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    await act(async () => {
      root!.render(createElement(QueryClientProvider, { client: qc },
        createElement('div', null,
          createElement(AddToListButton, { productId: 'p-focaccia' }),
          createElement(ListDetailPage as never, { params: { id: 'L1' } }))));
    });

    const menu = () => box.querySelector('[role="dialog"]') as HTMLElement | null;
    const avvio = () => [...box.querySelectorAll('button')].find((b) => /Aggiungi a lista/.test(b.textContent ?? '')) as HTMLButtonElement;
    const voceColazione = () => [...(menu()?.querySelectorAll('li button') ?? [])].find((b) => (b.textContent ?? '').includes('Colazione'));

    await act(async () => { avvio().click(); });
    await aspetta(() => voceColazione() !== undefined, 'la lista Colazione non è nel menu: la prova non guarda niente');
    await act(async () => { (menu()!.querySelector('button[aria-label="Chiudi"]') as HTMLButtonElement).click(); });
    expect(menu()).toBeNull();

    const cestino = () => box.querySelector('button[aria-label="Elimina"]') as HTMLButtonElement | null;
    await aspetta(() => cestino() !== null, 'la pagina della lista non offre «Elimina» a chi l’ha creata');
    await act(async () => { cestino()!.click(); });
    await aspetta(() => vi.mocked(toast.success).mock.calls.some((c) => c[0] === 'Lista eliminata'),
      'l’eliminazione non è finita');
    expect(db.liste).toEqual([]);

    // Si riapre il menu SUBITO: la rilettura (150 ms) non è ancora tornata, ma la lista eliminata
    // non deve esserci già, né come voce toccabile.
    await act(async () => { avvio().click(); });
    expect(menu(), 'il menu non si è riaperto').not.toBeNull();
    expect(voceColazione(), 'riaperto subito, il menu mostra ancora la lista eliminata').toBeUndefined();
    // E resta così quando la rilettura torna.
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(voceColazione()).toBeUndefined();
    expect(menu()!.textContent ?? '').toMatch(/Non hai ancora liste/);
  });
});
