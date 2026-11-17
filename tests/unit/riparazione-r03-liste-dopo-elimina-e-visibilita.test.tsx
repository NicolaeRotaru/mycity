/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 17/11/2026 — Dalla pagina di una lista (/lists/[id]) si può eliminare la lista o cambiarne la
 * visibilità. Dopo, la pagina rileggeva solo la lista stessa (o niente, e portava a /lists): /lists
 * legge le liste da altre chiavi della cache, e poteva mostrare ancora la lista eliminata, o
 * quella resa privata fra le pubbliche, finché le chiavi non scadevano. Qui si monta /lists per
 * sapere da quali chiavi legge, poi si elimina la lista (o se ne cambia la visibilità) e si guarda
 * quali chiavi la pagina chiede di rileggere. Se la scrittura non riesce, niente da rileggere.
 */
const conferma = vi.hoisted(() => ({ risposta: true }));

// React 18 non ha ancora `use`: la pagina lo usa per i parametri, che qui arrivano già pronti.
vi.mock('react', async (originale) => ({ ...(await originale<Record<string, unknown>>()), use: (v: unknown) => v }));
vi.mock('next/link', () => import('./aiuti/finti/next-link.mjs'));
vi.mock('next/image', () => import('./aiuti/finti/next-image.mjs'));
vi.mock('next/navigation', () => import('./aiuti/finti/next-navigation.mjs'));
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('@tanstack/react-query', () => import('./aiuti/finti/react-query.mjs'));
vi.mock('@/lib/supabase/client', () => import('./aiuti/finti/supabase-client.mjs'));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Il dialogo di conferma vive nella radice del sito: qui risponde la prova.
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => conferma.risposta) }));

import ListDetailPage from '@/app/lists/[id]/page';

const g = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: unknown[] };
const LISTA = {
  id: 'L1', owner_id: 'u-amica', title: 'Colazione', description: null,
  cover_emoji: null, is_public: true, updated_at: '2026-11-01T10:00:00Z', owner: null,
};
const RIGHE = [
  { list_id: 'L1', product_id: 'p1', sort_order: 0, note: null, product: { id: 'p1', name: 'Focaccia', price: 3, images: null, status: 'available' } },
];

let radice: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  radice?.remove();
  root = null;
  radice = null;
  conferma.risposta = true;
  for (const k of ['__DATI_QUERY__', '__UTENTE__', '__CLIENT_SUPABASE__', '__MUTAZIONI_VERE__', '__MUTAZIONI_IN_VOLO__', '__RILETTURE__', '__OPZIONI_QUERY__', '__NAVIGAZIONI__']) delete g[k];
  document.body.innerHTML = '';
});

/** Le chiavi della cache da cui /lists legge le liste. */
async function chiaviDiLists(): Promise<unknown[][]> {
  const opzioni: Opzioni[] = [];
  g.__OPZIONI_QUERY__ = opzioni;
  g.__DATI_QUERY__ = [];
  const mod = await monta('app/lists/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  s.smonta();
  delete g.__OPZIONI_QUERY__;
  delete g.__DATI_QUERY__;
  const chiavi = opzioni.map((o) => o.queryKey);
  expect(chiavi.length, '/lists non ha chiesto nessuna lista: la prova non guarda niente').toBeGreaterThan(0);
  return chiavi;
}

/** Come react-query: una rilettura vale per ogni chiave che comincia con la chiave data. */
const copre = (riletta: unknown, chiave: unknown[]) =>
  Array.isArray(riletta) && riletta.length <= chiave.length && riletta.every((v, i) => v === chiave[i]);

const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** Apre la lista come sua proprietaria, preme il pulsante e restituisce le chiavi chieste di rileggere. */
async function premiSullaLista(pulsante: 'Elimina' | 'Rendi privata', esitoScrittura: { error: unknown }) {
  g.__UTENTE__ = { id: 'u-amica' };
  g.__MUTAZIONI_VERE__ = true;
  const inVolo: Promise<unknown>[] = [];
  g.__MUTAZIONI_IN_VOLO__ = inVolo;
  const riletture: unknown[] = [];
  g.__RILETTURE__ = riletture;
  const navigazioni: Array<{ tipo: string; dove: string }> = [];
  g.__NAVIGAZIONI__ = navigazioni;
  const scritture: string[] = [];
  const catena = () => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'order', 'limit', 'eq']) c[m] = () => c;
    for (const m of ['update', 'delete']) c[m] = () => { scritture.push(m); return c; };
    c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, ...esitoScrittura }).then(r);
    return c;
  };
  g.__CLIENT_SUPABASE__ = { from: catena, rpc: async () => ({ data: null, error: null }) };
  g.__DATI_QUERY__ = (o: Opzioni) => (o.queryKey.includes('items') ? RIGHE : LISTA);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
  await act(async () => root!.render(createElement(ListDetailPage as never, { params: { id: 'L1' } })));
  await pausa();
  await pausa();
  const bottone = radice.querySelector(`button[aria-label="${pulsante}"]`);
  expect(bottone, `il pulsante «${pulsante}» non c’è`).not.toBeNull();
  riletture.length = 0;
  await act(async () => { clicca(bottone!); });
  await pausa();
  await act(async () => { await Promise.all(inVolo); });
  expect(scritture.length, 'la scrittura non è partita: la prova non guarda niente').toBeGreaterThan(0);
  return { riletture, navigazioni };
}

describe('dopo «elimina lista» e dopo il cambio di visibilità, /lists si rilegge', () => {
  it('dopo l’eliminazione riuscita ogni chiave da cui /lists legge viene riletta', async () => {
    const chiavi = await chiaviDiLists();
    const { riletture, navigazioni } = await premiSullaLista('Elimina', { error: null });
    for (const chiave of chiavi) {
      expect(riletture.some((r) => copre(r, chiave)), `dopo l’eliminazione /lists resta vecchio: ${JSON.stringify(chiave)} non si rilegge`).toBe(true);
    }
    // E porta a /lists come prima.
    expect(navigazioni).toContainEqual({ tipo: 'push', dove: '/lists' });
  });

  it('dopo il cambio di visibilità riuscito ogni chiave da cui /lists legge viene riletta', async () => {
    const chiavi = await chiaviDiLists();
    const { riletture } = await premiSullaLista('Rendi privata', { error: null });
    for (const chiave of chiavi) {
      expect(riletture.some((r) => copre(r, chiave)), `dopo il cambio di visibilità /lists resta vecchio: ${JSON.stringify(chiave)} non si rilegge`).toBe(true);
    }
    // La lista stessa si rilegge come prima.
    expect(riletture).toContainEqual(['lists', 'detail', 'L1']);
  });

  it('se l’eliminazione non riesce non si rilegge niente e si resta sulla lista', async () => {
    const { riletture, navigazioni } = await premiSullaLista('Elimina', { error: { message: 'rifiutato' } });
    expect(riletture).toEqual([]);
    expect(navigazioni).toEqual([]);
  });

  it('se il cambio di visibilità non riesce non si rilegge niente', async () => {
    const { riletture } = await premiSullaLista('Rendi privata', { error: { message: 'rifiutato' } });
    expect(riletture).toEqual([]);
  });
});
