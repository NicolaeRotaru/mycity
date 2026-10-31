/**
 * 31/10/2026 (collaudo dell'ondata 4) — RIMANDARE UN SALVATAGGIO GIA' SCRITTO NON E' UN CONFLITTO.
 *
 * Le tre porte che scrivono la scorta (quella del venditore, quella delle varianti, quella
 * dell'amministrazione) la scrivono solo se in banca dati c'e' ancora il numero visto
 * all'apertura. Ma il fornaio che porta la focaccia da 5 a 8, perde la risposta e preme di
 * nuovo «Salva» riceveva «avevi davanti 5 pezzi, ora sono 8» — cioe' il numero che stava
 * chiedendo — e non riusciva piu' a salvare niente, nemmeno la descrizione.
 *
 * Ogni porta qui fa le due cose insieme: il salvataggio rimandato passa, e la vendita vera
 * arrivata nel frattempo continua a fermare la scrittura.
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
  it('IL CASO CHE ROMPEVA — 5 portato a 8, gia\' scritto: ripremere «Salva» passa e salva il resto', async () => {
    const tabelle = { products: [focaccia(8)] };
    await expect(salva(tabelle, { stock: 8, stock_visto: 5, description: 'Focaccia con olio ligure.' })).resolves.toBeDefined();
    expect(tabelle.products[0].stock).toBe(8);
    expect(tabelle.products[0].description, 'il resto del salvataggio si perde').toBe('Focaccia con olio ligure.');
  });

  it('la vendita vera continua a fermare la scrittura: vista 5, venduti 2, scrive 6', async () => {
    const tabelle = { products: [focaccia(3)] };
    await expect(salva(tabelle, { stock: 6, stock_visto: 5 })).rejects.toThrow(/ora sono 3/);
    expect(tabelle.products[0].stock).toBe(3);
  });
});

describe('le varianti', () => {
  const variante = (stock: number) => [{ id: S, label: 'S', stock, price: null, sku: null, attributes: {}, position: 0 }];

  it('IL CASO CHE ROMPEVA — la S vista a 2, portata a 4 e gia\' scritta: ritentare passa', async () => {
    const tabelle = { product_variants: [{ id: S, product_id: PRODOTTO_ID, label: 'S', stock: 4 }] as Riga[] };
    await expect(
      saveProductVariantsServer(bancaDati(tabelle) as unknown as SupabaseClient, PRODOTTO_ID, variante(4) as never, { [S]: 2 }),
    ).resolves.toBeUndefined();
    expect(tabelle.product_variants[0].stock).toBe(4);
  });

  it('la S vista a 2, venduta a 1, riscritta a 4: niente si scrive', async () => {
    const tabelle = { product_variants: [{ id: S, product_id: PRODOTTO_ID, label: 'S', stock: 1 }] as Riga[] };
    await expect(
      saveProductVariantsServer(bancaDati(tabelle) as unknown as SupabaseClient, PRODOTTO_ID, variante(4) as never, { [S]: 2 }),
    ).rejects.toThrow(/ora sono 1/);
    expect(tabelle.product_variants[0].stock).toBe(1);
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

  it('IL CASO CHE ROMPEVA — 5 portato a 8, gia\' scritto: ritentare risponde 200 e corregge il nome', async () => {
    const tabelle = { products: [focaccia(8)] };
    globali.__ADMIN__ = bancaDati(tabelle);
    const res = await patch({ id: PRODOTTO_ID, stock: 8, stock_visto: 5, name: 'Focaccia genovese DOP' });
    expect(res.status).toBe(200);
    expect(tabelle.products[0].stock).toBe(8);
    expect(tabelle.products[0].name).toBe('Focaccia genovese DOP');
  });

  it('la vendita vera continua a fermare la scrittura: 409 e la banca dati resta quella vera', async () => {
    const tabelle = { products: [focaccia(3)] };
    globali.__ADMIN__ = bancaDati(tabelle);
    const res = await patch({ id: PRODOTTO_ID, stock: 6, stock_visto: 5, name: 'Focaccia genovese DOP' });
    expect(res.status).toBe(409);
    expect(tabelle.products[0].stock).toBe(3);
    expect(tabelle.products[0].name).toBe('Focaccia genovese');
  });
});
