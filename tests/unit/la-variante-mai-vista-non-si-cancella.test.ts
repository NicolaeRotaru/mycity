/**
 * 31/10/2026 (sesta ondata del sito, dopo il collaudo) — LA VARIANTE MAI VISTA NON SI CANCELLA.
 *
 * Il primo giro aveva fermato la pagina «Modifica prodotto» del venditore quando la lettura delle
 * varianti cade. Il collaudo ha trovato la stessa strada nel pannello admin: la pagina apre il
 * modulo con il ripiego `variants = []`, la PATCH /api/admin/products manda `variants: []` e
 * saveProductVariantsServer cancellava tutte le taglie. Esempio: «Maglietta» con M (3) e L (2),
 * la lettura delle varianti cade, l'amministratore corregge una parola e salva: M e L spariscono,
 * e negli ordini gia' fatti la riga perde la taglia (order_items.variant_id a NULL).
 *
 * Il freno sta dove si cancella, non in ogni pagina: chi salva porta le scorte viste all'apertura
 * (`scorteViste`, id → pezzi), e una variante che non c'era davanti non si tocca. Cosi' vale per
 * tutte le pagine che montano il modulo, anche quelle che verranno.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveProductVariantsServer } from '@/lib/products/persistVariantsServer';

type Riga = Record<string, unknown>;

function bancaDati(varianti: Riga[]) {
  const cancellate: string[] = [];
  const client = {
    from(tavola: string) {
      if (tavola !== 'product_variants') throw new Error(`tavola inattesa: ${tavola}`);
      return {
        select() {
          const filtri: Array<[string, unknown]> = [];
          const catena = {
            eq: (c: string, v: unknown) => (filtri.push([c, v]), catena),
            then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
              Promise.resolve({
                data: varianti.filter((r) => filtri.every(([c, v]) => r[c] === v)).map((r) => ({ id: r.id, stock: r.stock })),
                error: null,
              }).then(ok, ko),
          };
          return catena;
        },
        delete() {
          return {
            in: async (_c: string, ids: string[]) => {
              cancellate.push(...ids);
              for (const id of ids) varianti.splice(varianti.findIndex((r) => r.id === id), 1);
              return { error: null };
            },
          };
        },
        update(riga: Riga) {
          const catena = {
            eq: () => catena,
            select: async () => ({ data: [{ id: 'x' }], error: null }),
            then: (ok: (r: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
          };
          void riga;
          return catena;
        },
        insert: async (righe: Riga[]) => {
          varianti.push(...righe.map((r, i) => ({ id: `nuova-${i}`, ...r })));
          return { error: null };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, cancellate, varianti };
}

const PRODOTTO = 'maglietta';
const taglie = () => [
  { id: 'v-m', product_id: PRODOTTO, label: 'M', options: { Taglia: 'M' }, stock: 3 },
  { id: 'v-l', product_id: PRODOTTO, label: 'L', options: { Taglia: 'L' }, stock: 2 },
];

describe('saveProductVariantsServer cancella solo cio\' che il negoziante ha visto', () => {
  it('IL CASO CHE ROMPEVA — le varianti non si erano lette (modulo aperto senza taglie): M e L restano', async () => {
    const db = bancaDati(taglie());
    await saveProductVariantsServer(db.client, PRODOTTO, [], {});
    expect(db.cancellate, 'le taglie mai mostrate nel modulo sono state cancellate').toEqual([]);
    expect(db.varianti.map((v) => v.label)).toEqual(['M', 'L']);
  });

  it('una taglia aggiunta da un\'altra scheda mentre il modulo era aperto non si cancella', async () => {
    const db = bancaDati([...taglie(), { id: 'v-xl', product_id: PRODOTTO, label: 'XL', options: { Taglia: 'XL' }, stock: 1 }]);
    await saveProductVariantsServer(
      db.client,
      PRODOTTO,
      [
        { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3 },
        { id: 'v-l', options: { Taglia: 'L' }, label: 'L', stock: 2 },
      ],
      { 'v-m': 3, 'v-l': 2 },
    );
    expect(db.cancellate).toEqual([]);
  });

  it('controprova: la taglia vista e tolta dal negoziante si cancella davvero', async () => {
    const db = bancaDati(taglie());
    await saveProductVariantsServer(db.client, PRODOTTO, [{ id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3 }], {
      'v-m': 3,
      'v-l': 2,
    });
    expect(db.cancellate).toEqual(['v-l']);
  });

  it('controprova: chi non passa le scorte viste resta col comportamento di prima', async () => {
    const db = bancaDati(taglie());
    await saveProductVariantsServer(db.client, PRODOTTO, []);
    expect(db.cancellate).toEqual(['v-m', 'v-l']);
  });
});
