import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveProductVariantsServer } from '@/lib/products/persistVariantsServer';
import { DaCompletare } from '@/lib/products/salvataggio-tracciato';

/**
 * R20-015 — Salvando le taglie a pezzi (il ripiego quando la funzione `salva_varianti` della
 * migrazione 323 non c'è ancora), le taglie tolte si cancellavano PRIMA degli aggiornamenti
 * condizionati sulla scorta. Se un cliente comprava fra la lettura e la scrittura, il negozio
 * leggeva «riapri e salva di nuovo», ma la L tolta era già sparita (e negli ordini la riga
 * perdeva la taglia: ON DELETE SET NULL).
 *
 * Il client finto registra l'ordine delle chiamate e tiene le righe: la funzione del database
 * manca (PGRST202), quindi si passa dalle scritture a pezzi.
 */
type Riga = { id: string; product_id: string; label: string; stock: number; options?: unknown; position?: number };
const PRODOTTO = 'p-maglietta';

function bancaDati(opz: { vendita: boolean }) {
  let righe: Riga[] = [
    { id: 'v-s', product_id: PRODOTTO, label: 'S', stock: 2 },
    { id: 'v-m', product_id: PRODOTTO, label: 'M', stock: 5 },
    { id: 'v-l', product_id: PRODOTTO, label: 'L', stock: 1 },
  ];
  const chiamate: string[] = [];
  return {
    chiamate,
    stato: () => righe,
    client: {
      from: (tavola: string) => {
        if (tavola !== 'product_variants') throw new Error(`tavola inattesa: ${tavola}`);
        return {
          select: () => ({
            eq: async () => {
              chiamate.push('select');
              const viste = righe.map((r) => ({ id: r.id, stock: r.stock }));
              // Subito dopo la lettura un cliente compra una M: da 5 a 4.
              if (opz.vendita) righe = righe.map((r) => (r.id === 'v-m' ? { ...r, stock: 4 } : r));
              return { data: viste, error: null };
            },
          }),
          delete: () => ({
            in: async (_c: string, ids: string[]) => {
              chiamate.push(`delete ${ids.join(',')}`);
              righe = righe.filter((r) => !ids.includes(r.id));
              return { error: null };
            },
          }),
          update: (valori: Partial<Riga>) => {
            const filtri: Array<[string, unknown]> = [];
            const applica = () => {
              const tocca = righe.filter((r) => filtri.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
              chiamate.push(`update ${tocca.map((r) => r.id).join(',') || '(nessuna)'}`);
              righe = righe.map((r) => (tocca.includes(r) ? { ...r, ...valori } : r));
              return tocca;
            };
            const b = {
              eq: (c: string, v: unknown) => { filtri.push([c, v]); return b; },
              select: async () => ({ data: applica().map((r) => ({ id: r.id })), error: null }),
              then: (ok: (v: unknown) => unknown) => Promise.resolve().then(() => { applica(); return ok({ error: null }); }),
            };
            return b;
          },
          insert: async (nuove: Riga[]) => {
            chiamate.push(`insert ${nuove.map((n) => n.label).join(',')}`);
            righe = [...righe, ...nuove.map((n, i) => ({ ...n, id: `nuova-${i}` }))];
            return { error: null };
          },
        };
      },
      rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.salva_varianti' } }),
    } as unknown as SupabaseClient,
  };
}

// Il negoziante aveva davanti S 2, M 5, L 1: toglie la L, porta la S a 4 e la M a 3, aggiunge la XL.
const MODULO = [
  { id: 'v-s', label: 'S', options: { taglia: 'S' }, stock: 4 },
  { id: 'v-m', label: 'M', options: { taglia: 'M' }, stock: 3 },
  { label: 'XL', options: { taglia: 'XL' }, stock: 2 },
];
const VISTE = { 'v-s': 2, 'v-m': 5, 'v-l': 1 };
const riassunto = (r: Riga[]) => r.map((x) => `${x.label} ${x.stock}`).join(', ');

describe('R20-015 — un conflitto di scorta a metà non lascia le taglie tolte già cancellate', () => {
  it('una vendita fra lettura e scrittura: il negozio legge «salva di nuovo», e la L tolta c’è ancora', async () => {
    const db = bancaDati({ vendita: true });
    const esito = saveProductVariantsServer(db.client, PRODOTTO, MODULO as never, VISTE);
    await expect(esito).rejects.toBeInstanceOf(DaCompletare);
    await expect(esito).rejects.toThrow(/«M»/);
    expect(db.stato().map((r) => r.label), 'la L tolta è già cancellata mentre il negozio legge «riapri e salva di nuovo»').toContain('L');
    expect(db.chiamate.some((c) => c.startsWith('delete')), 'una cancellazione è partita prima del conflitto').toBe(false);
    expect(db.chiamate.some((c) => c.startsWith('insert')), 'la XL è entrata a metà salvataggio').toBe(false);
    // La M ha ancora la scorta vera (la vendita non si sovrascrive).
    expect(db.stato().find((r) => r.id === 'v-m')?.stock).toBe(4);
  });

  it('controllo: senza vendite in mezzo il negozio trova quello che ha salvato, come prima', async () => {
    const db = bancaDati({ vendita: false });
    await saveProductVariantsServer(db.client, PRODOTTO, MODULO as never, VISTE);
    expect(riassunto(db.stato())).toBe('S 4, M 3, XL 2');
  });

  it('l’ordine: prima gli aggiornamenti condizionati sulla scorta, poi la cancellazione e l’inserimento', async () => {
    const db = bancaDati({ vendita: false });
    await saveProductVariantsServer(db.client, PRODOTTO, MODULO as never, VISTE);
    expect(db.chiamate).toEqual(['select', 'update v-s', 'update v-m', 'delete v-l', 'insert XL']);
  });
});
