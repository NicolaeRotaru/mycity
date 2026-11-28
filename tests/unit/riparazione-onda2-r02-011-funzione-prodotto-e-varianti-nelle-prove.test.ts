import { describe, it, expect } from 'vitest';
import { salvaVariantiFinta } from './aiuti/salva-varianti-finta';

/**
 * R02-011 (onda 2) — LA FUNZIONE CHE SALVA PRODOTTO E VARIANTI IN UNA SCRITTURA SOLA, E LE PROVE.
 *
 * `public.salva_prodotto_e_varianti` (migrazioni 405 e 709) esiste nel database ma non la
 * chiamava nessuno: l'aiutante comune delle prove (`tests/unit/aiuti/salva-varianti-finta.ts`)
 * rispondeva «rpc inattesa» a qualunque rpc che non fosse `salva_varianti`, quindi la rotta che
 * l'avesse chiamata faceva cadere le prove della porta del catalogo. Adesso l'aiutante la conosce
 * e fa sulla banca dati finta quello che fa la funzione vera: prima i controlli, poi il prodotto,
 * poi le varianti.
 */

type Riga = Record<string, unknown>;

function bancaDati(tabelle: Record<string, Riga[]>) {
  const scritture: Array<{ tavola: string; tipo: string; valori: unknown }> = [];
  const client = {
    from(tavola: string) {
      const righe = () => tabelle[tavola] ?? (tabelle[tavola] = []);
      const filtrate = (filtri: Array<[string, unknown]>) => righe().filter((r) => filtri.every(([c, v]) => r[c] === v));
      return {
        select() {
          const filtri: Array<[string, unknown]> = [];
          const catena = {
            eq(c: string, v: unknown) { filtri.push([c, v]); return catena; },
            async maybeSingle() { return { data: filtrate(filtri)[0] ? { ...filtrate(filtri)[0] } : null, error: null }; },
            then(ok: (r: unknown) => unknown) { return Promise.resolve({ data: filtrate(filtri).map((r) => ({ ...r })), error: null }).then(ok); },
          };
          return catena;
        },
        update(valori: Riga) {
          const filtri: Array<[string, unknown]> = [];
          const applica = () => {
            const colpite = filtrate(filtri);
            for (const r of colpite) Object.assign(r, valori);
            scritture.push({ tavola, tipo: 'update', valori });
            return colpite;
          };
          const catena = {
            eq(c: string, v: unknown) { filtri.push([c, v]); return catena; },
            async select() { return { data: applica().map((r) => ({ id: r.id })), error: null }; },
            then(ok: (r: unknown) => unknown) { applica(); return Promise.resolve({ error: null }).then(ok); },
          };
          return catena;
        },
        delete() {
          return {
            async in(c: string, valori: unknown[]) {
              tabelle[tavola] = righe().filter((r) => !valori.includes(r[c]));
              scritture.push({ tavola, tipo: 'delete', valori });
              return { error: null };
            },
          };
        },
        async insert(nuove: Riga[]) {
          nuove.forEach((r, i) => righe().push({ id: `nuova-${i}`, ...r }));
          scritture.push({ tavola, tipo: 'insert', valori: nuove });
          return { error: null };
        },
      };
    },
  };
  return { client, scritture, tabelle };
}

const PRODOTTO = 'p-1';
const prima = () => ({
  products: [{ id: PRODOTTO, name: 'Felpa', price: 40, stock: 7 }],
  product_variants: [
    { id: 'v-s', product_id: PRODOTTO, label: 'S', options: { taglia: 'S' }, stock: 3, position: 0 },
    { id: 'v-m', product_id: PRODOTTO, label: 'M', options: { taglia: 'M' }, stock: 4, position: 1 },
  ],
});

describe('l aiutante delle prove conosce salva_prodotto_e_varianti', () => {
  it('scrive prodotto e varianti come la funzione vera', async () => {
    const db = bancaDati(prima());
    const rpc = salvaVariantiFinta(db.client);
    const esito = await rpc('salva_prodotto_e_varianti', {
      p_product_id: PRODOTTO,
      p_prodotto: { name: 'Felpa blu', price: 35 },
      p_scorta_vista: null,
      p_varianti: [
        { id: 'v-m', label: 'M', options: { taglia: 'M' }, stock: 4 },
        { label: 'L', options: { taglia: 'L' }, stock: 2 },
      ],
      p_scorte_viste: { 'v-s': 3, 'v-m': 4 },
    } as never);
    expect(esito.error).toBeNull();
    expect(db.tabelle.products[0]).toMatchObject({ name: 'Felpa blu', price: 35 });
    const taglie = db.tabelle.product_variants.map((v) => [v.label, v.stock, v.position]);
    // S vista e tolta: cancellata. M tenuta in prima posizione, scorta non riscritta. L nuova.
    expect(taglie).toEqual([['M', 4, 0], ['L', 2, 1]]);
    expect(db.scritture.find((s) => s.tavola === 'product_variants' && s.tipo === 'update')?.valori).not.toHaveProperty('stock');
  });

  it('una scorta di variante cambiata intanto ferma tutto: non resta scritto niente', async () => {
    const db = bancaDati(prima());
    db.tabelle.product_variants[0].stock = 2; // venduta una S mentre la scheda era aperta
    const esito = await salvaVariantiFinta(db.client)('salva_prodotto_e_varianti', {
      p_product_id: PRODOTTO,
      p_prodotto: { price: 30 },
      p_varianti: [
        { id: 'v-s', label: 'S', options: { taglia: 'S' }, stock: 5 },
        { id: 'v-m', label: 'M', options: { taglia: 'M' }, stock: 4 },
      ],
      p_scorte_viste: { 'v-s': 3, 'v-m': 4 },
    } as never);
    expect(esito.error).toMatchObject({ code: 'P0001', message: 'scorta_variante_cambiata' });
    expect(JSON.parse(String(esito.error?.details))).toMatchObject({ id: 'v-s', label: 'S', vista: 3, adesso: 2 });
    expect(db.scritture, 'con una condizione che non regge la funzione non scrive niente').toEqual([]);
    expect(db.tabelle.products[0].price).toBe(40);
  });

  it('la scorta del prodotto cambiata intanto ferma tutto', async () => {
    const db = bancaDati(prima());
    const esito = await salvaVariantiFinta(db.client)('salva_prodotto_e_varianti', {
      p_product_id: PRODOTTO,
      p_prodotto: { stock: 9, price: 30 },
      p_scorta_vista: 6,
      p_varianti: null,
    } as never);
    expect(esito.error).toMatchObject({ code: 'P0001', message: 'scorta_prodotto_cambiata' });
    expect(db.scritture).toEqual([]);
  });

  it('un prodotto che non c e risponde prodotto_non_trovato', async () => {
    const db = bancaDati(prima());
    const esito = await salvaVariantiFinta(db.client)('salva_prodotto_e_varianti', {
      p_product_id: 'non-esiste',
      p_prodotto: { price: 30 },
    } as never);
    expect(esito.error).toMatchObject({ code: 'P0002', message: 'prodotto_non_trovato' });
  });

  it('una rpc che l aiutante non conosce resta un errore della prova', async () => {
    const db = bancaDati(prima());
    await expect(salvaVariantiFinta(db.client)('altra_funzione', {} as never)).rejects.toThrow(/rpc inattesa/);
  });
});
