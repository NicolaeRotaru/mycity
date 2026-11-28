import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL SALVATAGGIO DI PRODOTTO E VARIANTI DALL'AMMINISTRAZIONE È UNA SCRITTURA SOLA.
 *
 * La rotta faceva due passi: prima il prodotto (nome, prezzo), poi le varianti. Una taglia venduta
 * fra il controllo delle scorte e la scrittura delle varianti dava 409 con il prezzo nuovo già
 * scritto: il ripristino lo rimetteva com'era, ma l'effetto del trigger del prezzo abbassato restava
 * (ai clienti partiva un «prezzo abbassato» falso, migrations/405). Adesso con le varianti scrive la
 * funzione del database `salva_prodotto_e_varianti` (405, 709), in una transazione: se una
 * condizione non regge non resta scritto niente.
 *
 * Qui il database è finto: la funzione finta controlla tutto prima di scrivere, come quella vera,
 * e un prezzo abbassato su `products` fa partire l'avviso, come il trigger vero.
 */

type Riga = Record<string, unknown>;
type Esito = { data: unknown; error: { code?: string; message: string; details?: string } | null };

const db: {
  products: Riga[];
  product_variants: Riga[];
  profiles: Riga[];
  /** Le scritture dirette della rotta su products e product_variants (non quelle della funzione). */
  scritture: Array<{ tavola: string; valori: Riga }>;
  avvisiPrezzo: number[];
  rpc: Array<{ nome: string; argomenti: Riga }>;
  audit: Riga[];
  /** La vendita che arriva subito prima della prima scrittura. */
  primaDiScrivere: (() => void) | null;
  funzione: 'presente' | 'mancante' | 'rotta-dentro';
} = {
  products: [], product_variants: [], profiles: [], scritture: [], avvisiPrezzo: [], rpc: [], audit: [],
  primaDiScrivere: null, funzione: 'presente',
};

function primaScrittura() {
  const vendita = db.primaDiScrivere;
  db.primaDiScrivere = null;
  vendita?.();
}

/** Come trg_product_price_drop: un prezzo che scende fa partire l'avviso ai clienti. */
function aggiornaProdotto(r: Riga, valori: Riga) {
  if (typeof valori.price === 'number' && typeof r.price === 'number' && valori.price < r.price) db.avvisiPrezzo.push(valori.price);
  Object.assign(r, valori);
}

/** La funzione del database, finta: prima tutti i controlli, poi le scritture (tutto o niente). */
function salvaProdottoEVarianti(a: Riga): Esito {
  if (db.funzione === 'mancante') {
    return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.salva_prodotto_e_varianti in the schema cache' } };
  }
  if (db.funzione === 'rotta-dentro') {
    return { data: null, error: { code: '42883', message: 'function public.salva_varianti(uuid, uuid[], jsonb, jsonb) does not exist' } };
  }
  primaScrittura();
  const prodotto = db.products.find((r) => r.id === a.p_product_id);
  if (!prodotto) return { data: null, error: { code: 'P0002', message: 'prodotto_non_trovato' } };
  const patch = a.p_prodotto as Riga;
  if ('stock' in patch && a.p_scorta_vista != null && prodotto.stock !== a.p_scorta_vista) {
    return { data: null, error: { code: 'P0001', message: 'scorta_prodotto_cambiata', details: JSON.stringify({ vista: a.p_scorta_vista, adesso: prodotto.stock }) } };
  }
  const viste = a.p_scorte_viste as Record<string, number> | null;
  const varianti = a.p_varianti as Riga[];
  for (const v of varianti) {
    const riga = db.product_variants.find((x) => x.id === v.id);
    const vista = viste?.[String(v.id)];
    if (riga && vista !== undefined && v.stock !== vista && riga.stock !== vista) {
      return {
        data: null,
        error: { code: 'P0001', message: 'scorta_variante_cambiata', details: JSON.stringify({ id: v.id, label: v.label, vista, adesso: riga.stock }) },
      };
    }
  }
  if (Object.keys(patch).length > 0) aggiornaProdotto(prodotto, patch);
  varianti.forEach((v, i) => {
    const riga = db.product_variants.find((x) => x.id === v.id);
    if (riga) Object.assign(riga, { label: v.label, options: v.options, stock: v.stock, position: i });
  });
  return { data: null, error: null };
}

/** La funzione delle sole varianti (323), per il percorso in due passi. */
function salvaVarianti(a: Riga): Esito {
  primaScrittura();
  const aggiorna = a.p_update as Array<Riga & { vista?: number }>;
  for (const u of aggiorna) {
    const riga = db.product_variants.find((x) => x.id === u.id);
    if (u.vista !== undefined && riga?.stock !== u.vista) return { data: null, error: { code: 'P0001', message: 'scorta_cambiata', details: String(u.id) } };
  }
  for (const { id, vista: _vista, ...campi } of aggiorna) {
    Object.assign(db.product_variants.find((x) => x.id === id)!, campi);
    db.scritture.push({ tavola: 'product_variants', valori: campi });
  }
  return { data: null, error: null };
}

const client = {
  from(tavola: 'products' | 'product_variants' | 'profiles') {
    const righe = () => db[tavola];
    return {
      select() {
        const filtri: Array<[string, unknown]> = [];
        const scelte = () => righe().filter((x) => filtri.every(([c, v]) => x[c] === v)).map((x) => ({ ...x }));
        const catena = {
          eq(c: string, v: unknown) { filtri.push([c, v]); return catena; },
          async maybeSingle() { return { data: scelte()[0] ?? null, error: null }; },
          then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
            return Promise.resolve({ data: scelte(), error: null }).then(ok, ko);
          },
        };
        return catena;
      },
      update(valori: Riga) {
        const filtri: Array<[string, unknown]> = [];
        const applica = () => {
          primaScrittura();
          db.scritture.push({ tavola, valori });
          const colpite = righe().filter((x) => filtri.every(([c, v]) => x[c] === v));
          colpite.forEach((x) => (tavola === 'products' ? aggiornaProdotto(x, valori) : Object.assign(x, valori)));
          return colpite;
        };
        const catena = {
          eq(c: string, v: unknown) { filtri.push([c, v]); return catena; },
          async select() { return { data: applica().map((x) => ({ id: x.id })), error: null }; },
          then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
            applica();
            return Promise.resolve({ data: null, error: null }).then(ok, ko);
          },
        };
        return catena;
      },
    };
  },
  async rpc(nome: string, argomenti: Riga): Promise<Esito> {
    db.rpc.push({ nome, argomenti });
    if (nome === 'salva_prodotto_e_varianti') return salvaProdottoEVarianti(argomenti);
    if (nome === 'salva_varianti') return salvaVarianti(argomenti);
    return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nome}` } };
  },
};

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => client }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (fn: (a: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      fn({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: async (voce: Riga) => { db.audit.push(voce); } }));

import { PATCH } from '@/app/api/admin/products/route';

const ID = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-0000-4000-8000-00000000000a';
const M = 'bbbbbbbb-0000-4000-8000-00000000000b';

async function salva(corpo: Riga) {
  const res = (await PATCH(
    new Request('http://localhost/api/admin/products', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID, ...corpo }),
    }) as never,
  )) as Response;
  const dati = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: dati.error?.message ?? '' };
}

/** La scheda aperta con S a 2 e M a 3: l'amministratore porta S a 4, cambia nome e abbassa il prezzo. */
const modulo = {
  name: 'Maglietta blu',
  price: 8,
  variants: [
    { id: S, options: { taglia: 'S' }, label: 'S', stock: 4 },
    { id: M, options: { taglia: 'M' }, label: 'M', stock: 3 },
  ],
  scorteViste: { [S]: 2, [M]: 3 },
};
const vendeUnaS = () => { db.product_variants.find((x) => x.id === S)!.stock = 1; };
const prodotto = () => db.products.find((r) => r.id === ID)!;

beforeEach(() => {
  db.products = [{ id: ID, name: 'Maglietta', price: 10, stock: 5 }];
  db.product_variants = [
    { id: S, product_id: ID, options: { taglia: 'S' }, label: 'S', stock: 2, position: 0 },
    { id: M, product_id: ID, options: { taglia: 'M' }, label: 'M', stock: 3, position: 1 },
  ];
  db.profiles = [];
  db.scritture = [];
  db.avvisiPrezzo = [];
  db.rpc = [];
  db.audit = [];
  db.primaDiScrivere = null;
  db.funzione = 'presente';
});

describe('salvataggio di prodotto e varianti dall amministrazione', () => {
  it('la S venduta proprio prima della scrittura: 409, e del prodotto non resta scritto niente', async () => {
    db.primaDiScrivere = vendeUnaS;
    const r = await salva(modulo);

    expect(r.status).toBe(409);
    expect(r.messaggio).toContain('«S»');
    expect(db.scritture, 'nome e prezzo scritti prima delle varianti').toEqual([]);
    expect(db.avvisiPrezzo, 'un «prezzo abbassato» partito per un salvataggio rifiutato').toEqual([]);
    expect(prodotto()).toMatchObject({ name: 'Maglietta', price: 10 });
    expect(db.product_variants.find((x) => x.id === S)!.stock, 'la vendita resta').toBe(1);
  });

  it('senza vendite in mezzo: una chiamata sola alla funzione, con tutto il modulo', async () => {
    const r = await salva(modulo);

    expect(r.status).toBe(200);
    expect(db.rpc).toEqual([
      {
        nome: 'salva_prodotto_e_varianti',
        argomenti: {
          p_product_id: ID,
          p_prodotto: { name: 'Maglietta blu', price: 8 },
          p_scorta_vista: null,
          p_varianti: [
            { id: S, options: { taglia: 'S' }, label: 'S', stock: 4 },
            { id: M, options: { taglia: 'M' }, label: 'M', stock: 3 },
          ],
          p_scorte_viste: { [S]: 2, [M]: 3 },
        },
      },
    ]);
    expect(db.scritture).toEqual([]);
    expect(prodotto()).toMatchObject({ name: 'Maglietta blu', price: 8 });
    expect(db.product_variants.find((x) => x.id === S)!.stock).toBe(4);
    // La traccia «chi ha cambiato cosa» c'è ancora, con i campi e le taglie.
    expect((db.audit[0]?.metadata as { campi?: string[] })?.campi).toEqual(['name', 'price', 'variants']);
  });

  it('la scorta del prodotto cambiata: la condizione passa alla funzione, stesso 409 di prima', async () => {
    db.products[0].stock = 4;
    const r = await salva({ ...modulo, stock: 7, stock_visto: 5 });
    expect(r.status).toBe(409);
    expect(r.messaggio).toContain('avevi davanti 5 pezzi');
    expect(prodotto()).toMatchObject({ name: 'Maglietta', price: 10, stock: 4 });
  });

  it('senza la funzione nel database (migrazione non applicata) resta il percorso in due passi', async () => {
    db.funzione = 'mancante';
    const r = await salva(modulo);
    expect(r.status).toBe(200);
    expect(prodotto()).toMatchObject({ name: 'Maglietta blu', price: 8 });
    expect(db.product_variants.find((x) => x.id === S)!.stock).toBe(4);
  });

  it('un errore nato dentro la funzione non ripiega sui due passi', async () => {
    db.funzione = 'rotta-dentro';
    const r = await salva(modulo);
    expect(r.status).toBe(500);
    expect(db.scritture).toEqual([]);
    expect(prodotto()).toMatchObject({ name: 'Maglietta', price: 10 });
  });
});
