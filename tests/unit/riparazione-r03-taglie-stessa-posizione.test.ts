import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-001 — Taglie alla stessa posizione: la traccia non segna un riordino che non c'è.
 *
 * Il salvataggio vero (lib/products/persistVariantsServer.ts) scrive le posizioni 0..n-1 nell'ordine
 * del modulo e tiene gli id delle taglie che c'erano già. Due taglie che prima stavano tutte e due a
 * posizione 0 non avevano un ordine: rimandate in qualunque ordine, non è un riordino. Un riordino
 * vero è solo quello di due taglie con posizioni di prima diverse che arrivano invertite.
 */

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  prodotti: [] as Riga[],
  taglie: [] as Riga[],
  audit: [] as Array<Record<string, unknown>>,
  nuove: 0,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (fn: (a: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      fn({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: async (voce: Record<string, unknown>) => {
    db.audit.push(voce);
  },
}));
// Come il salvataggio vero: posizione = ordine del modulo (0..n-1), id tenuti per le taglie che
// c'erano, id nuovi per quelle nuove, cancellate quelle tolte.
vi.mock('@/lib/products/persistVariantsServer', () => ({
  controllaScorteVarianti: async () => undefined,
  saveProductVariantsServer: async (_a: unknown, productId: string, variants: Array<Riga>) => {
    const esistenti = new Set(db.taglie.filter((t) => t.product_id === productId).map((t) => t.id));
    const altre = db.taglie.filter((t) => t.product_id !== productId);
    db.taglie = [
      ...altre,
      ...variants.map((v, i) => ({
        id: typeof v.id === 'string' && esistenti.has(v.id) ? v.id : `nuova-${++db.nuove}`,
        product_id: productId,
        options: v.options,
        label: v.label,
        stock: v.stock,
        position: i,
      })),
    ];
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    // 27/11/2026 — La funzione che salva prodotto e varianti in una transazione non c'è in questo
    // finto, come in un database senza la migrazione: la rotta torna ai due passi che la prova guarda.
    rpc: async (nome: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nome} in the schema cache` } }),
    from(tavola: string) {
      const righe = () => (tavola === 'products' ? db.prodotti : tavola === 'product_variants' ? db.taglie : []);
      return {
        select() {
          const filtri: Array<[string, unknown]> = [];
          const scelte = () => righe().filter((x) => filtri.every(([c, v]) => x[c] === v)).map((x) => ({ ...x }));
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            async maybeSingle() {
              return { data: scelte()[0] ?? null, error: null };
            },
            then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
              return Promise.resolve({ data: scelte(), error: null }).then(ok, ko);
            },
          };
          return catena;
        },
        update(valori: Riga) {
          const filtri: Array<[string, unknown]> = [];
          const applica = () => {
            const colpite = righe().filter((x) => filtri.every(([c, v]) => x[c] === v));
            colpite.forEach((x) => Object.assign(x, valori));
            return colpite;
          };
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            async select() {
              return { data: applica().map((x) => ({ id: x.id })), error: null };
            },
            then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
              applica();
              return Promise.resolve({ error: null }).then(ok, ko);
            },
          };
          return catena;
        },
      };
    },
  }),
}));

import { PATCH } from '@/app/api/admin/products/route';

const ID = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-0000-4000-8000-000000000000';
const M = 'aaaaaaaa-1111-4111-8111-111111111111';
const L = 'bbbbbbbb-2222-4222-8222-222222222222';
const salva = (corpo: Record<string, unknown>) =>
  PATCH(
    new Request('http://localhost/api/admin/products', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID, ...corpo }),
    }) as never,
  );
const taglia = (id: string, nome: string, pezzi: number) => ({ id, options: { taglia: nome }, label: nome, stock: pezzi });
const inBanca = (id: string, nome: string, pezzi: number, posizione: number) => ({
  ...taglia(id, nome, pezzi),
  product_id: ID,
  position: posizione,
});
const voceDelleTaglie = () => db.audit.filter((v) => ((v.metadata as { campi?: string[] })?.campi ?? []).includes('variants'));

beforeEach(() => {
  db.audit.length = 0;
  db.nuove = 0;
  db.prodotti = [{ id: ID, name: 'Maglietta', price: '10.00' }];
  // Vecchie M e L tutte e due a posizione 0 (dati di prima del salvataggio 0..n-1).
  db.taglie = [inBanca(M, 'M', 3, 0), inBanca(L, 'L', 2, 0)];
});

describe('R03-001 · taglie alla stessa posizione', () => {
  it('vecchie M e L a posizione 0, il modulo rimanda M, L: nessun riordino nella traccia', async () => {
    const res = await salva({ variants: [taglia(M, 'M', 3), taglia(L, 'L', 2)] });
    expect(res.status).toBe(200);
    expect(db.taglie.map((t) => [t.label, t.position])).toEqual([['M', 0], ['L', 1]]);
    expect(voceDelleTaglie(), "un riordino che non c'è è finito nella traccia").toHaveLength(0);
  });

  it('vecchie M e L a posizione 0, il modulo rimanda L, M: nessun riordino nella traccia', async () => {
    const res = await salva({ variants: [taglia(L, 'L', 2), taglia(M, 'M', 3)] });
    expect(res.status).toBe(200);
    expect(db.taglie.map((t) => [t.label, t.position])).toEqual([['L', 0], ['M', 1]]);
    expect(voceDelleTaglie(), "un riordino che non c'è è finito nella traccia").toHaveLength(0);
  });

  it('tre taglie, S e M a posizione 0 e L a 1: M, S, L non è un riordino; L davanti a S sì', async () => {
    db.taglie = [inBanca(S, 'S', 1, 0), inBanca(M, 'M', 3, 0), inBanca(L, 'L', 2, 1)];
    await salva({ variants: [taglia(M, 'M', 3), taglia(S, 'S', 1), taglia(L, 'L', 2)] });
    expect(voceDelleTaglie(), "un riordino che non c'è è finito nella traccia").toHaveLength(0);

    db.taglie = [inBanca(S, 'S', 1, 0), inBanca(M, 'M', 3, 0), inBanca(L, 'L', 2, 1)];
    await salva({ variants: [taglia(M, 'M', 3), taglia(L, 'L', 2), taglia(S, 'S', 1)] });
    expect(voceDelleTaglie(), 'L (prima a 1) è passata davanti a S (prima a 0): è un riordino').toHaveLength(1);
  });

  it('riordino vero, M a 0 e L a 1 rimandate L, M: la traccia lo segna', async () => {
    db.taglie = [inBanca(M, 'M', 3, 0), inBanca(L, 'L', 2, 1)];
    const res = await salva({ variants: [taglia(L, 'L', 2), taglia(M, 'M', 3)] });
    expect(res.status).toBe(200);
    const voci = voceDelleTaglie();
    expect(voci).toHaveLength(1);
    const meta = voci[0].metadata as { prima: { variants: Array<{ label: string }> }; dopo: { variants: Array<{ label: string }> } };
    expect(meta.prima.variants.map((t) => t.label)).toEqual(['M', 'L']);
    expect(meta.dopo.variants.map((t) => t.label)).toEqual(['L', 'M']);
    expect(meta.dopo.variants[0]).toEqual({ label: 'L', options: { taglia: 'L' }, stock: 2 });
  });

  it('controprova: una scorta cambiata davvero entra ancora nella traccia', async () => {
    const res = await salva({ variants: [taglia(M, 'M', 5), taglia(L, 'L', 2)] });
    expect(res.status).toBe(200);
    expect(voceDelleTaglie()).toHaveLength(1);
  });
});
