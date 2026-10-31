/**
 * 31/10/2026 (secondo giro dell'ondata 4) — LA SCORTA SI CONFRONTA CON QUELLA VISTA, NON CON QUELLA SCRITTA.
 *
 * Il primo giro aveva aggiunto una scorciatoia alle tre porte che scrivono la scorta (quella del
 * venditore, quella delle varianti, quella dell'amministrazione): «se in banca dati c'e' gia' il
 * numero che chiedi, e' un salvataggio rimandato, non un conflitto». Ma lo stesso quadro nasce da
 * una vendita. Alle 9 il fornaio apre la focaccia: 5. Alle 9:05 un cliente ne compra 1 online (in
 * banca dati 4). Alle 9:10 gliene cade una e scrive 4. La scorciatoia salvava 4 senza avviso, e in
 * vetrina restava una focaccia che non esiste: la vera e' 3. Idem la taglia S: vista 2, venduta 1,
 * il negoziante ne toglie una e scrive 1.
 *
 * Da qui i due casi non si distinguono, quindi vince quello che costa soldi: e' sempre un
 * conflitto. Il salvataggio rimandato riceve «ora sono 8» e il modulo riparte dalla banca dati
 * (prova: dopo-una-scorta-cambiata-lista-e-modulo-ripartono-dalla-banca-dati).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salvaProdottoTracciato, type ClientDelCatalogo } from '@/lib/products/salvataggio-tracciato';
import { saveProductVariantsServer } from '@/lib/products/persistVariantsServer';
import type { SupabaseClient } from '@supabase/supabase-js';

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

/** Una banca dati finta: ogni lettura e ogni scrittura rispettano i loro `.eq()`. */
function bancaDati(tabelle: Record<string, Riga[]>) {
  return {
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
              return { data: trova()[0] ?? null, error: null };
            },
            then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
              return Promise.resolve({ data: trova(), error: null }).then(ok, ko);
            },
          };
          return catena;
        },
        update(valori: Riga) {
          const filtri: Array<[string, unknown]> = [];
          const applica = () => {
            const colpite = righe().filter((r) => filtri.every(([c, v]) => r[c] === v));
            colpite.forEach((r) => Object.assign(r, valori));
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
            then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
              applica();
              return Promise.resolve({ error: null }).then(ok, ko);
            },
          };
          return catena;
        },
        delete() {
          return {
            async in(_c: string, ids: string[]) {
              tabelle[tavola] = righe().filter((r) => !ids.includes(r.id as string));
              return { error: null };
            },
          };
        },
        async insert(nuove: Riga[]) {
          tabelle[tavola] = [...righe(), ...nuove];
          return { error: null };
        },
      };
    },
  };
}

const PRODOTTO_ID = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

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

function salva(tabelle: Record<string, Riga[]>, payload: Riga) {
  return salvaProdottoTracciato({
    db: bancaDati(tabelle) as unknown as ClientDelCatalogo,
    prodottoId: PRODOTTO_ID,
    attoreId: 'seller-1',
    payload,
    origine: 'venditore-elenco-blocco',
    scriviTraccia: () => undefined,
  });
}

describe('la porta del venditore', () => {
  it('IL CASO CHE ROMPEVA — vista 5, venduta 1 online (in banca 4), lui scrive 4: conflitto con avviso', async () => {
    const tabelle = { products: [focaccia(4)] };
    await expect(salva(tabelle, { stock: 4, stock_visto: 5, description: 'Focaccia con olio ligure.' })).rejects.toThrow(
      /avevi davanti 5 pezzi, ora sono 4/,
    );
    expect(tabelle.products[0].stock).toBe(4);
    expect(tabelle.products[0].description, 'una parte del salvataggio e\' passata lo stesso').toBe(
      'Focaccia con olio extravergine.',
    );
  });

  it('le altre vendite vere fermano la scrittura come prima: scrive 3 o 6 con in banca 4', async () => {
    for (const scritto of [3, 6]) {
      const tabelle = { products: [focaccia(4)] };
      await expect(salva(tabelle, { stock: scritto, stock_visto: 5 })).rejects.toThrow(/ora sono 4/);
      expect(tabelle.products[0].stock).toBe(4);
    }
  });

  it('il salvataggio rimandato (5 portato a 8, gia\' scritto) dice «ora sono 8», non scrive in silenzio', async () => {
    const tabelle = { products: [focaccia(8)] };
    await expect(salva(tabelle, { stock: 8, stock_visto: 5 })).rejects.toThrow(/ora sono 8/);
    expect(tabelle.products[0].stock).toBe(8);
  });

  it('la scorta non toccata non parte: vista 5, scritta 5, in banca 4 — si salva il resto e resta 4', async () => {
    const tabelle = { products: [focaccia(4)] };
    await salva(tabelle, { stock: 5, stock_visto: 5, description: 'Focaccia con olio ligure.' });
    expect(tabelle.products[0].stock).toBe(4);
    expect(tabelle.products[0].description).toBe('Focaccia con olio ligure.');
  });
});

describe('le varianti', () => {
  const variante = (stock: number) => [{ id: S, label: 'S', stock, options: {}, position: 0 }];

  it('IL CASO CHE ROMPEVA — la S vista a 2, venduta a 1, il negoziante ne toglie una e scrive 1: conflitto', async () => {
    const tabelle = { product_variants: [{ id: S, product_id: PRODOTTO_ID, label: 'S', stock: 1 }] as Riga[] };
    await expect(
      saveProductVariantsServer(bancaDati(tabelle) as unknown as SupabaseClient, PRODOTTO_ID, variante(1) as never, { [S]: 2 }),
    ).rejects.toThrow(/avevi davanti 2 pezzi, ora sono 1/);
    expect(tabelle.product_variants[0].stock).toBe(1);
  });

  it('la vendita che arriva fra la lettura e la scrittura non viene sovrascritta', async () => {
    // La lettura vede la S a 2 (quella vista); un attimo dopo un ordine la porta a 1.
    const tabelle = { product_variants: [{ id: S, product_id: PRODOTTO_ID, label: 'S', stock: 2 }] as Riga[] };
    const vera = bancaDati(tabelle);
    const db = {
      from(tavola: string) {
        const f = vera.from(tavola);
        return {
          ...f,
          select() {
            const catena = f.select();
            return {
              eq(c: string, v: unknown) {
                const filtrata = catena.eq(c, v);
                return {
                  then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
                    return Promise.resolve(filtrata)
                      .then((r) => {
                        tabelle.product_variants[0].stock = 1;
                        return r;
                      })
                      .then(ok, ko);
                  },
                };
              },
            };
          },
        };
      },
    };
    await expect(
      saveProductVariantsServer(db as unknown as SupabaseClient, PRODOTTO_ID, variante(4) as never, { [S]: 2 }),
    ).rejects.toThrow(/scorta di «S» è cambiata/);
    expect(tabelle.product_variants[0].stock, 'la vendita delle 9:05 e\' sparita').toBe(1);
  });

  it('la S cambiata a mano senza vendite in mezzo si scrive', async () => {
    const tabelle = { product_variants: [{ id: S, product_id: PRODOTTO_ID, label: 'S', stock: 2 }] as Riga[] };
    await saveProductVariantsServer(bancaDati(tabelle) as unknown as SupabaseClient, PRODOTTO_ID, variante(4) as never, { [S]: 2 });
    expect(tabelle.product_variants[0].stock).toBe(4);
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

  it('IL CASO CHE ROMPEVA — vista 5, in banca 4, scritto 4: 409 e niente si scrive', async () => {
    const tabelle = { products: [focaccia(4)] };
    globali.__ADMIN__ = bancaDati(tabelle);
    const res = await patch({ id: PRODOTTO_ID, stock: 4, stock_visto: 5, name: 'Focaccia genovese DOP' });
    expect(res.status).toBe(409);
    expect(tabelle.products[0].stock).toBe(4);
    expect(tabelle.products[0].name).toBe('Focaccia genovese');
  });

  it('la vendita vera continua a fermare la scrittura: vista 5, in banca 3, scritto 6', async () => {
    const tabelle = { products: [focaccia(3)] };
    globali.__ADMIN__ = bancaDati(tabelle);
    const res = await patch({ id: PRODOTTO_ID, stock: 6, stock_visto: 5, name: 'Focaccia genovese DOP' });
    expect(res.status).toBe(409);
    expect(tabelle.products[0].stock).toBe(3);
    expect(tabelle.products[0].name).toBe('Focaccia genovese');
  });
});
