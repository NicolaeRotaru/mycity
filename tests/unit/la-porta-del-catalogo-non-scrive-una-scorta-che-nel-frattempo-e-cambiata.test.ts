import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salvaProdottoTracciato, type ClientDelCatalogo } from '@/lib/products/salvataggio-tracciato';
import { saveProductVariantsServer } from '@/lib/products/persistVariantsServer';

/**
 * 31/10/2026 — LA SCORTA SI SCRIVE SOLO SE IN BANCA DATI C'E' ANCORA QUELLA VISTA.
 *
 * Alle 9 il fornaio apre la focaccia: scorta 5. Alle 9:05 due clienti ne
 * comprano una a testa e in banca dati resta 3. Alle 9:10 scrive 6 per
 * aggiungerne una appena sfornata. La porta scriveva 6 — un numero assoluto,
 * senza guardare — e due focacce che non esistono tornavano in vetrina.
 *
 * Qui le porte girano davvero su una banca dati finta che rispetta i filtri
 * della scrittura: la prova guarda cosa resta in banca dati, non cosa e'
 * stato chiesto.
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

function salva(db: unknown, payload: Riga) {
  return salvaProdottoTracciato({
    db: db as ClientDelCatalogo,
    prodottoId: PRODOTTO_ID,
    attoreId: 'seller-1',
    payload,
    origine: 'venditore-modulo',
    scriviTraccia: () => undefined,
  });
}

describe('la porta del venditore: confronta e scrive', () => {
  it('IL CASO CHE ROMPEVA — vista 5, venduti 2, scrive 6: non scrive e lo dice', async () => {
    const tabelle = { products: [focaccia(3)] };
    const { db } = bancaDati(tabelle);
    await expect(salva(db, { stock: 6, stock_visto: 5 })).rejects.toThrow(/ora sono 3/);
    expect(tabelle.products[0].stock, 'due focacce vendute tornano in vetrina').toBe(3);
  });

  it('corregge la descrizione: la scorta vista non riscrive quella vera, la descrizione si salva', async () => {
    const tabelle = { products: [focaccia(3)] };
    const { db } = bancaDati(tabelle);
    const esito = await salva(db, { description: 'Focaccia con olio ligure.', stock: 5, stock_visto: 5 });
    expect(tabelle.products[0].stock, 'la merce venduta nel frattempo torna in magazzino').toBe(3);
    expect(tabelle.products[0].description).toBe('Focaccia con olio ligure.');
    expect(esito.campi).toEqual(['description']);
  });

  it('un ordine arriva fra la rilettura e la scrittura: la condizione sta nella scrittura stessa', async () => {
    const tabelle = { products: [focaccia(5)] };
    const { db } = bancaDati(tabelle, () => {
      tabelle.products[0].stock = 4;
    });
    await expect(salva(db, { stock: 6, stock_visto: 5 })).rejects.toThrow(/cambiata/);
    expect(tabelle.products[0].stock).toBe(4);
  });

  it('nessuno ha comprato: il numero del negoziante si scrive', async () => {
    const tabelle = { products: [focaccia(5)] };
    const { db } = bancaDati(tabelle);
    const esito = await salva(db, { stock: 6, stock_visto: 5 });
    expect(tabelle.products[0].stock).toBe(6);
    expect(esito.campi).toEqual(['stock']);
  });
});

describe('le varianti: quella cambiata a mano si scrive solo se nessuno l\'ha mossa', () => {
  it('S vista a 2, venduta a 1, riscritta a 4: niente si scrive, la vendita resta', async () => {
    const tabelle = {
      product_variants: [
        { id: S, product_id: PRODOTTO_ID, label: 'S', stock: 1 },
        { id: M, product_id: PRODOTTO_ID, label: 'M', stock: 3 },
      ],
    };
    const { db, scritture } = bancaDati(tabelle);
    await expect(
      saveProductVariantsServer(
        db as never,
        PRODOTTO_ID,
        [
          { id: S, options: { Taglia: 'S' }, label: 'S', stock: 4 },
          { id: M, options: { Taglia: 'M' }, label: 'M', stock: 3 },
        ],
        { [S]: 2, [M]: 3 },
      ),
    ).rejects.toThrow(/ora sono 1/);
    expect(tabelle.product_variants.find((r) => r.id === S)?.stock).toBe(1);
    expect(scritture, 'una scrittura parte prima del controllo').toEqual([]);
  });
});

describe('la porta dell\'amministrazione', () => {
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

  it('IL CASO CHE ROMPEVA — corregge un refuso su un prodotto con taglie: la S venduta resta venduta', async () => {
    const tabelle = {
      products: [focaccia(4)],
      product_variants: [
        { id: S, product_id: PRODOTTO_ID, label: 'S', stock: 1 },
        { id: M, product_id: PRODOTTO_ID, label: 'M', stock: 3 },
      ],
    };
    globali.__ADMIN__ = bancaDati(tabelle).db;
    const res = await patch({
      id: PRODOTTO_ID,
      name: 'Focaccia genovese DOP',
      variants: [
        { id: S, options: { Taglia: 'S' }, label: 'S', stock: 2 },
        { id: M, options: { Taglia: 'M' }, label: 'M', stock: 3 },
      ],
      scorteViste: { [S]: 2, [M]: 3 },
    });
    expect(res.status).toBe(200);
    expect(tabelle.products[0].name).toBe('Focaccia genovese DOP');
    expect(
      tabelle.product_variants.find((r) => r.id === S)?.stock,
      'la S venduta mentre la scheda era aperta torna in vetrina',
    ).toBe(1);
  });

  it('cambia la scorta mentre arrivano ordini: 409 e la banca dati resta quella vera', async () => {
    const tabelle = { products: [focaccia(3)] };
    globali.__ADMIN__ = bancaDati(tabelle).db;
    const res = await patch({ id: PRODOTTO_ID, stock: 6, stock_visto: 5 });
    expect(res.status).toBe(409);
    expect(tabelle.products[0].stock).toBe(3);
  });
});
