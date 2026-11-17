/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R02-008 — Dopo aver tolto un prodotto da una lista (/lists/[id]) la pagina rileggeva solo i
 * prodotti della lista: il conteggio «N prodotti» in /lists, che sta in altre chiavi della cache,
 * restava vecchio finché non scadeva. Qui si monta /lists per sapere da quali chiavi legge, poi si
 * toglie un prodotto dalla lista e si guarda quali chiavi la pagina chiede di rileggere.
 */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const g = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: unknown[] };
const LISTA = {
  id: 'L1', owner_id: 'u-amica', title: 'Colazione', description: null,
  cover_emoji: null, is_public: true, updated_at: '2026-11-01T10:00:00Z', owner: null,
};
const RIGHE = [
  { list_id: 'L1', product_id: 'p1', sort_order: 0, note: null, product: { id: 'p1', name: 'Focaccia', price: 3, images: null, status: 'available' } },
];

afterEach(() => {
  for (const k of ['__DATI_QUERY__', '__UTENTE__', '__CLIENT_SUPABASE__', '__MUTAZIONI_VERE__', '__MUTAZIONI_IN_VOLO__', '__RILETTURE__', '__OPZIONI_QUERY__']) delete g[k];
  document.body.innerHTML = '';
});

/** Le chiavi della cache da cui /lists legge le liste col loro conteggio. */
async function chiaviDiLists(): Promise<unknown[][]> {
  const opzioni: Opzioni[] = [];
  g.__OPZIONI_QUERY__ = opzioni;
  g.__DATI_QUERY__ = [];
  const mod = await monta('app/lists/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  s.smonta();
  delete g.__OPZIONI_QUERY__;
  const chiavi = opzioni.map((o) => o.queryKey);
  expect(chiavi.length, '/lists non ha chiesto nessuna lista: la prova non guarda niente').toBeGreaterThan(0);
  return chiavi;
}

/** Come react-query: una rilettura vale per ogni chiave che comincia con la chiave data. */
const copre = (riletta: unknown, chiave: unknown[]) =>
  Array.isArray(riletta) && riletta.length <= chiave.length && riletta.every((v, i) => v === chiave[i]);

async function togliDallaLista(esitoDelete: { error: unknown }) {
  g.__UTENTE__ = { id: 'u-amica' };
  g.__MUTAZIONI_VERE__ = true;
  const inVolo: Promise<unknown>[] = [];
  g.__MUTAZIONI_IN_VOLO__ = inVolo;
  const riletture: unknown[] = [];
  g.__RILETTURE__ = riletture;
  const catena = () => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'order', 'limit', 'update', 'insert', 'delete', 'eq']) c[m] = () => c;
    c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, ...esitoDelete }).then(r);
    return c;
  };
  g.__CLIENT_SUPABASE__ = { from: catena, rpc: async () => ({ data: null, error: null }) };
  g.__DATI_QUERY__ = (o: Opzioni) => (o.queryKey.includes('items') ? RIGHE : LISTA);
  const mod = await monta('app/lists/[id]/page.tsx');
  const s = accendi(mod.default, { params: { id: 'L1' } });
  await attendi();
  await attendi();
  const cestino = s.radice.querySelector('button[aria-label="Rimuovi"]');
  expect(cestino, 'il cestino del prodotto non c’è').not.toBeNull();
  riletture.length = 0;
  s.agisci(() => clicca(cestino!));
  await Promise.all(inVolo);
  s.smonta();
  return riletture;
}

describe('R02-008 · dopo aver tolto un prodotto da una lista, il conteggio in /lists si rilegge', () => {
  it('ogni chiave da cui /lists legge il conteggio viene riletta dopo la rimozione', async () => {
    const chiavi = await chiaviDiLists();
    const riletture = await togliDallaLista({ error: null });
    for (const chiave of chiavi) {
      expect(riletture.some((r) => copre(r, chiave)), `dopo la rimozione /lists resta vecchio: ${JSON.stringify(chiave)} non si rilegge`).toBe(true);
    }
    // I prodotti della lista stessa si rileggono come prima.
    expect(riletture).toContainEqual(['lists', 'items', 'L1']);
  });

  it('se la rimozione non riesce non si rilegge niente', async () => {
    const riletture = await togliDallaLista({ error: { message: 'rifiutato' } });
    expect(riletture).toEqual([]);
  });
});
