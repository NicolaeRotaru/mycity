/**
 * @vitest-environment jsdom
 *
 *  * Dalla pagina di una lista (/lists/[id]) chi l'ha creata la rinomina. Il menu «Aggiungi a lista»
 * della scheda prodotto legge i titoli da una sua chiave della cache (le mie liste, versione
 * minima), che la rinomina non rileggeva: il menu mostrava il titolo vecchio finché la chiave
 * non scadeva (30 secondi).
 *
 * Qui il pulsante della scheda prodotto e la pagina della lista stanno nello stesso QueryClient
 * vero (con i 30 secondi di «fresco» del sito), sopra un database finto in memoria: si apre il
 * menu, lo si chiude, si rinomina la lista e si riapre il menu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({
  liste: [] as Array<Record<string, unknown>>,
  righe: [] as Array<Record<string, unknown>>,
  ritardo: 0,
}));

vi.mock('@/lib/supabase/client', () => {
  function domanda(tabella: string) {
    const filtri: Array<[string, unknown]> = [];
    let operazione: 'select' | 'update' | 'delete' = 'select';
    let modifica: Record<string, unknown> = {};
    let una = false;
    const passa = (r: Record<string, unknown>) => filtri.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
    const esegui = () => {
      const righe = tabella === 'product_list_items' ? db.righe : db.liste;
      if (operazione === 'update') {
        const aggiornate = righe.map((l) => (passa(l) ? { ...l, ...modifica } : l));
        if (tabella === 'product_list_items') db.righe = aggiornate; else db.liste = aggiornate;
        return { data: null, error: null };
      }
      if (operazione === 'delete') {
        const restanti = righe.filter((l) => !passa(l));
        if (tabella === 'product_list_items') db.righe = restanti; else db.liste = restanti;
        return { data: null, error: null };
      }
      const scelte = righe.filter(passa);
      return { data: una ? (scelte[0] ?? null) : scelte, error: null };
    };
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.limit = () => c;
    c.eq = (k: string, v: unknown) => { filtri.push([k, v]); return c; };
    c.in = (k: string, v: unknown[]) => { filtri.push([k, v]); return c; };
    c.update = (v: Record<string, unknown>) => { operazione = 'update'; modifica = v; return c; };
    c.delete = () => { operazione = 'delete'; return c; };
    c.maybeSingle = () => { una = true; return c; };
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      (db.ritardo ? new Promise((r) => setTimeout(r, db.ritardo)).then(() => esegui()) : Promise.resolve(esegui())).then(ok, ko);
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

function scrivi(campo: HTMLInputElement, valore: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, valore);
  campo.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('dopo una rinomina, il menu «Aggiungi a lista» mostra il titolo nuovo', () => {
  it('riaprendo il menu della scheda prodotto la lista ha il titolo nuovo', async () => {
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
    const titoliNelMenu = () => [...(menu()?.querySelectorAll('li button') ?? [])].map((b) => b.textContent ?? '');

    await act(async () => { avvio().click(); });
    await aspetta(() => titoliNelMenu().some((t) => t.includes('Colazione')), 'la lista Colazione non è nel menu: la prova non guarda niente');
    await act(async () => { (menu()!.querySelector('button[aria-label="Chiudi"]') as HTMLButtonElement).click(); });
    expect(menu()).toBeNull();

    const matita = () => box.querySelector('button[aria-label="Modifica"]') as HTMLButtonElement | null;
    await aspetta(() => matita() !== null, 'la pagina della lista non offre «Modifica» a chi l’ha creata');
    await act(async () => { matita()!.click(); });
    const campo = box.querySelector('input[aria-label="Titolo della lista"]') as HTMLInputElement;
    await act(async () => { scrivi(campo, 'Merenda'); });
    const salva = [...box.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Salva') as HTMLButtonElement;
    await act(async () => { salva.click(); });
    await aspetta(() => db.liste[0]?.title === 'Merenda', 'il nuovo titolo non è arrivato al database');

    await act(async () => { avvio().click(); });
    await aspetta(() => titoliNelMenu().some((t) => t.includes('Merenda')),
      `dopo la rinomina il menu mostra ancora il titolo vecchio: ${JSON.stringify(titoliNelMenu())}`);
    expect(titoliNelMenu().some((t) => t.includes('Colazione'))).toBe(false);
  });
});
