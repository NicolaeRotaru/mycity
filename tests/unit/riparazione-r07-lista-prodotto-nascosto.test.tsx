/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R07-014 (12/11/2026) — in una lista, un prodotto che il negozio ha tolto dalla
 * vetrina arriva con `product: null`: la riga non si disegnava (`if (!p) return null`),
 * il conteggio della lista lo contava ancora, e il cestino stava dentro la riga che
 * non c'era. Ora la riga si vede, «Non più disponibile», e chi ha la lista la toglie.
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
  { list_id: 'L1', product_id: 'p-tolto', sort_order: 1, note: null, product: null },
];

afterEach(() => {
  for (const k of ['__DATI_QUERY__', '__UTENTE__', '__CLIENT_SUPABASE__', '__MUTAZIONI_VERE__', '__MUTAZIONI_IN_VOLO__']) delete g[k];
  document.body.innerHTML = '';
});

async function pagina() {
  g.__DATI_QUERY__ = (o: Opzioni) => (o.queryKey.includes('items') ? RIGHE : LISTA);
  const mod = await monta('app/lists/[id]/page.tsx');
  const s = accendi(mod.default, { params: { id: 'L1' } });
  await attendi();
  await attendi();
  return s;
}

describe('R07-014 · il prodotto tolto dalla vetrina resta in lista, visibile e togliibile', () => {
  it('chi visita vede la riga «Non più disponibile», senza cestino', async () => {
    g.__UTENTE__ = { id: 'u-giulia' };
    const s = await pagina();
    expect(testoVisibile(s.radice)).toMatch(/Non più disponibile/);
    expect(Array.from(s.radice.querySelectorAll('li')).filter((li) => /Focaccia|Non più disponibile/.test(li.textContent ?? '')).length).toBe(2);
    expect(s.radice.querySelectorAll('button[aria-label="Rimuovi"]').length).toBe(0);
  });

  it('chi ha la lista la toglie: il cestino cancella proprio quel product_id', async () => {
    g.__UTENTE__ = { id: 'u-amica' };
    g.__MUTAZIONI_VERE__ = true;
    const inVolo: Promise<unknown>[] = [];
    g.__MUTAZIONI_IN_VOLO__ = inVolo;
    const filtri: Array<[string, unknown]> = [];
    let cancellata = '';
    const catena = (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'order', 'limit', 'update', 'insert']) c[m] = () => c;
      c.delete = () => { cancellata = tavola; return c; };
      c.eq = (col: string, v: unknown) => { filtri.push([col, v]); return c; };
      c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r);
      return c;
    };
    g.__CLIENT_SUPABASE__ = { from: catena, rpc: async () => ({ data: null, error: null }) };
    const s = await pagina();
    const riga = Array.from(s.radice.querySelectorAll('li')).find((li) => /Non più disponibile/.test(li.textContent ?? ''));
    expect(riga).toBeTruthy();
    const cestino = riga!.querySelector('button[aria-label="Rimuovi"]');
    expect(cestino).not.toBeNull();
    s.agisci(() => clicca(cestino!));
    await Promise.all(inVolo);
    expect(cancellata).toBe('product_list_items');
    expect(filtri).toContainEqual(['product_id', 'p-tolto']);
  });
});
