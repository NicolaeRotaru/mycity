import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveProductVariantsServer } from '@/lib/products/persistVariantsServer';
import { DaCompletare } from '@/lib/products/salvataggio-tracciato';

/**
 * R08-008 — il salvataggio delle varianti non era tutto-o-niente: cancellava, poi
 * aggiornava una riga alla volta, poi inseriva. Se a metà una scrittura condizionata
 * trovava la scorta cambiata, quello già fatto restava.
 *
 * La banca dati finta qui sotto ha le due strade: le scritture «a pezzi» (from) e la
 * funzione `salva_varianti`, che come quella vera (migrations/323, provata su Postgres in
 * tests/sql/rls/riparazione-r08-le-varianti-tutte-o-nessuna.test.sql) applica tutto o
 * niente. Il caso è quello della scheda: una vendita arriva fra la lettura e la scrittura.
 */
type Riga = { id: string; product_id: string; label: string; stock: number; options?: unknown; position?: number };
const PRODOTTO = 'p-maglietta';

function bancaDati(opz: { funzione: 'c-e' | 'manca' | 'rotta'; vendita?: boolean }) {
  let righe: Riga[] = [
    { id: 'v-s', product_id: PRODOTTO, label: 'S', stock: 2 },
    { id: 'v-m', product_id: PRODOTTO, label: 'M', stock: 5 },
    { id: 'v-l', product_id: PRODOTTO, label: 'L', stock: 1 },
  ];
  const aPezzi: string[] = [];
  let letture = 0;
  // Dopo la prima lettura arriva un ordine: la M passa da 5 a 4.
  const vendita = () => { if (opz.vendita !== false && letture === 1) righe = righe.map((r) => (r.id === 'v-m' ? { ...r, stock: 4 } : r)); };

  const client = {
    from: () => ({
      select: () => ({
        eq: async () => { letture += 1; const d = righe.map((r) => ({ id: r.id, stock: r.stock })); vendita(); return { data: d, error: null }; },
      }),
      delete: () => ({ in: async (_c: string, ids: string[]) => { aPezzi.push(`delete ${ids}`); righe = righe.filter((r) => !ids.includes(r.id)); return { error: null }; } }),
      update: (valori: Partial<Riga>) => {
        const filtri: Array<[string, unknown]> = [];
        const b = {
          eq: (c: string, v: unknown) => { filtri.push([c, v]); return b; },
          select: async () => {
            const tocca = righe.filter((r) => filtri.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
            aPezzi.push(`update ${tocca.map((r) => r.id)}`);
            righe = righe.map((r) => (tocca.includes(r) ? { ...r, ...valori } : r));
            return { data: tocca.map((r) => ({ id: r.id })), error: null };
          },
          then: (ok: (v: unknown) => unknown) => b.select().then(() => ok({ error: null })),
        };
        return b;
      },
      insert: async (nuove: Riga[]) => { aPezzi.push(`insert ${nuove.length}`); righe = [...righe, ...nuove.map((n, i) => ({ ...n, id: `nuova-${i}` }))]; return { error: null }; },
    }),
    rpc: async (nome: string, a: { p_delete: string[]; p_update: Array<Riga & { vista?: number }>; p_insert: Riga[] }) => {
      if (nome !== 'salva_varianti') throw new Error(nome);
      if (opz.funzione === 'manca') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.salva_varianti' } };
      if (opz.funzione === 'rotta') return { data: null, error: { code: '42501', message: 'permission denied' } };
      // Tutto o niente: si controlla prima, si scrive dopo.
      for (const u of a.p_update) {
        const r = righe.find((x) => x.id === u.id);
        if (u.vista !== undefined && r && r.stock !== u.vista) {
          return { data: null, error: { code: 'P0001', message: 'scorta_cambiata', details: u.id } };
        }
      }
      righe = righe.filter((r) => !a.p_delete.includes(r.id));
      righe = righe.map((r) => { const u = a.p_update.find((x) => x.id === r.id); return u ? { ...r, ...u } : r; });
      righe = [...righe, ...a.p_insert.map((n, i) => ({ ...n, product_id: PRODOTTO, id: `nuova-${i}` }))];
      return { data: null, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, stato: () => righe, aPezzi };
}

// Il negoziante: toglie la L, porta la S a 4 e la M a 3, aggiunge la XL. Aveva davanti S 2, M 5, L 1.
const MODULO = [
  { id: 'v-s', label: 'S', options: { taglia: 'S' }, stock: 4 },
  { id: 'v-m', label: 'M', options: { taglia: 'M' }, stock: 3 },
  { label: 'XL', options: { taglia: 'XL' }, stock: 2 },
];
const VISTE = { 'v-s': 2, 'v-m': 5, 'v-l': 1 };
const riassunto = (r: Riga[]) => r.map((x) => `${x.label} ${x.stock}`).join(', ');

describe('R08-008 — le varianti si salvano tutte o nessuna', () => {
  it('una vendita arrivata fra lettura e scrittura ferma tutto: niente resta a metà, e il negoziante lo sa', async () => {
    const db = bancaDati({ funzione: 'c-e' });
    const esito = saveProductVariantsServer(db.client, PRODOTTO, MODULO as never, VISTE);
    await expect(esito).rejects.toBeInstanceOf(DaCompletare);
    await expect(saveProductVariantsServer(bancaDati({ funzione: 'c-e' }).client, PRODOTTO, MODULO as never, VISTE)).rejects.toThrow(/«M»/);
    expect(riassunto(db.stato())).toBe('S 2, M 4, L 1');
    expect(db.aPezzi).toEqual([]);
  });

  it('senza vendite in mezzo passa tutto, in una volta sola (nessuna scrittura a pezzi)', async () => {
    const db = bancaDati({ funzione: 'c-e', vendita: false });
    await saveProductVariantsServer(db.client, PRODOTTO, MODULO as never, VISTE);
    expect(riassunto(db.stato())).toBe('S 4, M 3, XL 2');
    expect(db.aPezzi).toEqual([]);
  });

  it('ripiego: se la funzione non c’è ancora (PGRST202) il salvataggio si fa come prima, a pezzi', async () => {
    const db = bancaDati({ funzione: 'manca' });
    await expect(saveProductVariantsServer(db.client, PRODOTTO, MODULO as never, VISTE)).rejects.toBeInstanceOf(DaCompletare);
    // a pezzi la L era già cancellata prima del conflitto: è il comportamento di prima, dichiarato
    expect(db.aPezzi[0]).toBe('delete v-l');
  });

  it('un altro errore della funzione esce com’è e non fa partire le scritture a pezzi', async () => {
    const db = bancaDati({ funzione: 'rotta' });
    await expect(saveProductVariantsServer(db.client, PRODOTTO, MODULO as never, VISTE)).rejects.toMatchObject({ code: '42501' });
    expect(db.aPezzi).toEqual([]);
    expect(riassunto(db.stato())).toBe('S 2, M 4, L 1');
  });
});
