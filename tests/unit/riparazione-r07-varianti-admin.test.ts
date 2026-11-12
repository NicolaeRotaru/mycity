import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R07-019 (12/11/2026) — il salvataggio dell'amministrazione faceva due passi: prima il
 * prodotto, poi le varianti. Se una taglia era stata venduta mentre la scheda era aperta,
 * nome e prezzo restavano salvati e le varianti no. Ora la porta controlla le scorte
 * delle varianti PRIMA di scrivere qualunque cosa.
 */
const globali = globalThis as Record<string, unknown>;

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (fn: (a: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      fn({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => globali.__ADMIN__ }));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));

type Riga = Record<string, unknown>;

/** Una banca dati finta: tabelle di righe, e ogni scrittura rispetta i suoi `.eq()`. */
function bancaDati(tabelle: Record<string, Riga[]>, dopoLaLettura?: () => void) {
  const scritture: Array<{ tavola: string; valori: Riga }> = [];
  const db = {
    from(tavola: string) {
      const righe = () => tabelle[tavola] ?? [];
      return {
        select() {
          const filtri: Array<[string, unknown]> = [];
          const trova = () => righe().filter((r) => filtri.every(([c, v]) => r[c] === v)).map((r) => ({ ...r }));
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            async maybeSingle() {
              const [prima] = trova();
              dopoLaLettura?.();
              return { data: prima ?? null, error: null };
            },
            then(risolvi: (r: unknown) => unknown, rifiuta?: (e: unknown) => unknown) {
              return Promise.resolve({ data: trova(), error: null }).then(risolvi, rifiuta);
            },
          };
          return catena;
        },
        update(valori: Riga) {
          const filtri: Array<[string, unknown]> = [];
          const applica = () => {
            const colpite = righe().filter((r) => filtri.every(([c, v]) => r[c] === v));
            colpite.forEach((r) => Object.assign(r, valori));
            if (colpite.length > 0) scritture.push({ tavola, valori });
            return colpite;
          };
          const catena = {
            eq(c: string, v: unknown) {
              filtri.push([c, v]);
              return catena;
            },
            async select() {
              return { data: applica().map((r) => ({ id: r.id })), error: null };
            },
            then(risolvi: (r: unknown) => unknown, rifiuta?: (e: unknown) => unknown) {
              applica();
              return Promise.resolve({ error: null }).then(risolvi, rifiuta);
            },
          };
          return catena;
        },
        delete() {
          return {
            async in(_c: string, ids: string[]) {
              tabelle[tavola] = righe().filter((r) => !ids.includes(r.id as string));
              scritture.push({ tavola, valori: { cancellate: ids } });
              return { error: null };
            },
          };
        },
        async insert(nuove: Riga[]) {
          tabelle[tavola] = [...righe(), ...nuove];
          scritture.push({ tavola, valori: { inserite: nuove.length } });
          return { error: null };
        },
      };
    },
  };
  return { db, scritture };
}

const PRODOTTO_ID = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const M = '33333333-3333-4333-8333-333333333333';

function focaccia(stock: number): Riga {
  return {
    id: PRODOTTO_ID,
    seller_id: 'seller-1',
    name: 'Focaccia genovese',
    description: 'Focaccia con olio extravergine.',
    price: 4,
    stock,
    category_id: 'cat-1',
    images: ['https://mycity.test/focaccia.jpg'],
    attributes: {},
    status: 'available',
  };
}

describe('R07-019 · la porta dell amministrazione non scrive mezzo salvataggio', () => {
  beforeEach(() => {
    delete globali.__ADMIN__;
  });

  async function patch(corpo: Riga) {
    const { PATCH } = await import('@/app/api/admin/products/route');
    const req = new Request('http://mycity.test/api/admin/products', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    return (PATCH as unknown as (r: Request) => Promise<Response>)(req);
  }

  it('S vista a 2, venduta a 1, riscritta a 4 insieme a nome e prezzo: 409, e nome e prezzo restano quelli di prima', async () => {
    const tabelle = {
      products: [focaccia(4)],
      product_variants: [
        { id: S, product_id: PRODOTTO_ID, label: 'S', stock: 1 },
        { id: M, product_id: PRODOTTO_ID, label: 'M', stock: 3 },
      ],
    };
    const { db, scritture } = bancaDati(tabelle);
    globali.__ADMIN__ = db;
    const prima = { ...tabelle.products[0] };
    const res = await patch({
      id: PRODOTTO_ID,
      name: 'Focaccia genovese DOP',
      price: 4.5,
      variants: [
        { id: S, options: { Taglia: 'S' }, label: 'S', stock: 4 },
        { id: M, options: { Taglia: 'M' }, label: 'M', stock: 3 },
      ],
      scorteViste: { [S]: 2, [M]: 3 },
    });
    expect(res.status).toBe(409);
    expect(tabelle.products[0].name).toBe(prima.name);
    expect(tabelle.products[0].price).toBe(prima.price);
    expect(scritture, 'una scrittura parte prima del controllo').toEqual([]);
  });

  it('nessuno ha venduto: prodotto e varianti si salvano', async () => {
    const tabelle = {
      products: [focaccia(4)],
      product_variants: [{ id: S, product_id: PRODOTTO_ID, label: 'S', stock: 2 }],
    };
    globali.__ADMIN__ = bancaDati(tabelle).db;
    const res = await patch({
      id: PRODOTTO_ID,
      name: 'Focaccia genovese DOP',
      variants: [{ id: S, options: { Taglia: 'S' }, label: 'S', stock: 4 }],
      scorteViste: { [S]: 2 },
    });
    expect(res.status).toBe(200);
    expect(tabelle.products[0].name).toBe('Focaccia genovese DOP');
    expect(tabelle.product_variants.find((r) => r.id === S)?.stock).toBe(4);
  });
});
