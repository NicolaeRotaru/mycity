/**
 * @vitest-environment jsdom
 *
 * R10-007, R10-008 — Dalla pagina di una lista (/lists/[id]) chi l'ha creata ne cambia titolo e
 * descrizione. Dopo il salvataggio la pagina rileggeva solo la lista stessa: /lists legge le liste
 * (le mie, le pubbliche, quelle in vetrina) da altre chiavi della cache, e mostrava ancora il
 * titolo e la descrizione vecchi finché quelle chiavi non scadevano.
 *
 * Qui /lists e la pagina della lista stanno nello stesso QueryClient vero (con i 30 secondi di
 * «fresco» del sito), sopra un database finto in memoria: si rinomina la lista e si guarda cosa
 * mostra /lists.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const db = vi.hoisted(() => ({
  liste: [] as Array<Record<string, unknown>>,
  righe: [] as Array<{ list_id: string; product_id: string }>,
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

const COLAZIONE = {
  id: 'L1', owner_id: 'u-maria', title: 'Colazione', description: 'Le cose del mattino', cover_emoji: null,
  is_public: true, is_featured: true, updated_at: '2026-11-01T10:00:00Z',
};

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function aspetta(cond: () => boolean, cosa: string) {
  await vi.waitFor(() => { expect(cond(), cosa).toBe(true); }, { timeout: 3000, interval: 10 });
}

/** Titoli e descrizioni che /lists mostra nelle sue schede (le mie, in vetrina, pubbliche). */
const titoliInLists = (box: HTMLElement) =>
  [...box.querySelectorAll('a[href="/lists/L1"] h3')].map((h) => (h.textContent ?? '').trim());
const descrizioniInLists = (box: HTMLElement) =>
  [...box.querySelectorAll('a[href="/lists/L1"] p')].map((p) => (p.textContent ?? '').trim());

function scrivi(campo: HTMLInputElement | HTMLTextAreaElement, valore: string) {
  const proto = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(campo, valore);
  campo.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('dopo aver rinominato una lista, /lists mostra titolo e descrizione nuovi', () => {
  it('il salvataggio dalla pagina della lista aggiorna le schede di /lists', async () => {
    db.liste = [{ ...COLAZIONE }];
    db.righe = [];
    const box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    await act(async () => {
      root!.render(createElement(QueryClientProvider, { client: qc },
        createElement('div', null,
          createElement(ListsPage),
          createElement(ListDetailPage as never, { params: { id: 'L1' } }))));
    });
    await aspetta(() => titoliInLists(box).length === 3, '/lists non ha ancora disegnato la lista nelle tre sezioni');
    expect(titoliInLists(box)).toEqual(['Colazione', 'Colazione', 'Colazione']);

    const matita = () => box.querySelector('button[aria-label="Modifica"]') as HTMLButtonElement | null;
    await aspetta(() => matita() !== null, 'la pagina della lista non offre «Modifica» a chi l’ha creata');
    await act(async () => { matita()!.click(); });

    const titolo = box.querySelector('input[aria-label="Titolo della lista"]') as HTMLInputElement;
    const descrizione = box.querySelector('textarea[aria-label="Descrizione della lista (facoltativa)"]') as HTMLTextAreaElement;
    expect(titolo, 'il campo del titolo non c’è').not.toBeNull();
    await act(async () => { scrivi(titolo, 'Merenda'); scrivi(descrizione, 'Le cose del pomeriggio'); });
    const salva = [...box.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Salva') as HTMLButtonElement;
    expect(salva, 'il pulsante «Salva» non c’è').toBeTruthy();
    await act(async () => { salva.click(); });

    await aspetta(() => db.liste[0]?.title === 'Merenda', 'il nuovo titolo non è arrivato al database');
    await aspetta(() => titoliInLists(box).every((t) => t === 'Merenda'),
      `dopo il salvataggio /lists mostra ancora il titolo vecchio: ${JSON.stringify(titoliInLists(box))}`);
    await aspetta(() => {
      const d = descrizioniInLists(box);
      return d.filter((x) => x === 'Le cose del pomeriggio').length === 3 && !d.includes('Le cose del mattino');
    },
      `dopo il salvataggio /lists mostra ancora la descrizione vecchia: ${JSON.stringify(descrizioniInLists(box))}`);
  });
});
