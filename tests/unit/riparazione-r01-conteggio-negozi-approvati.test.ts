/**
 * R01-013 — il conteggio delle Novità conta solo i prodotti dei negozi approvati, come la lettura.
 *
 * La lettura della griglia tiene solo i prodotti il cui negozio compare nella vista pubblica dei
 * negozi (`seller_public_profiles`, che ha solo i negozi approvati). Il conteggio invece contava
 * tutto `products` con status 'available': per chi la regola del database lascia vedere anche
 * prodotti di negozi non approvati (il negoziante in attesa vede i suoi, l'amministratore tutti)
 * il numero in alto superava le schede che si possono vedere.
 *
 * Il finto qui sotto si comporta come PostgREST anche sugli agganci: `alias:vista!inner(...)`
 * scarta le righe che nella vista non hanno il loro negozio, e il conteggio esatto conta quelle
 * rimaste. Un aggancio senza `!inner` non filtra niente, come sul server vero.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contaProdottiDellaGriglia, leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';

type Riga = Record<string, unknown>;

/** Per ogni vista/tabella agganciabile da `products`, la colonna che la punta. */
const CHIAVE_ESTERNA: Record<string, string> = { seller_public_profiles: 'seller_id' };

function fintoConAgganci(tabelle: Record<string, Riga[]>) {
  const chiamate: Array<{ tabella: string; colonne: string; conteggio: boolean }> = [];
  const from = (tabella: string) => {
    let colonne = '*';
    let conteggio = false;
    const filtri: Array<(r: Riga) => boolean> = [];
    let tetto: number | null = null;
    let finestra: [number, number] | null = null;
    const q = {
      select(c = '*', o?: { count?: string; head?: boolean }) { colonne = c; conteggio = o?.count === 'exact'; return q; },
      eq(col: string, v: unknown) { filtri.push((r) => r[col] === v); return q; },
      in(col: string, vs: readonly unknown[]) { filtri.push((r) => vs.includes(r[col])); return q; },
      gte(col: string, v: unknown) { filtri.push((r) => String(r[col]) >= String(v)); return q; },
      lte(col: string, v: unknown) { filtri.push((r) => String(r[col]) <= String(v)); return q; },
      ilike() { return q; },
      or() { return q; },
      order() { return q; },
      limit(n: number) { tetto = n; return q; },
      range(a: number, b: number) { finestra = [a, b]; return q; },
      then<T>(risolvi: (v: { data: Riga[]; error: null; count: number | null }) => T) {
        chiamate.push({ tabella, colonne, conteggio });
        let righe = (tabelle[tabella] ?? []).filter((r) => filtri.every((f) => f(r)));
        for (const m of colonne.matchAll(/(?:(\w+):)?(\w+)(!inner)?\(([^)]*)\)/g)) {
          const [, , vista, inner] = m;
          const fk = CHIAVE_ESTERNA[vista];
          if (!fk) throw new Error(`aggancio sconosciuto: ${vista}`);
          if (inner) righe = righe.filter((r) => (tabelle[vista] ?? []).some((v) => v.id === r[fk]));
        }
        const n = righe.length;
        if (finestra) righe = righe.slice(finestra[0], finestra[1] + 1);
        else if (tetto != null) righe = righe.slice(0, tetto);
        return Promise.resolve(risolvi({ data: righe, error: null, count: conteggio ? n : null }));
      },
    };
    return q;
  };
  return { chiamate, client: { from, rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient };
}

const APPROVATO = 'aaaaaaaa-0000-0000-0000-000000000001';
const IN_ATTESA = 'bbbbbbbb-0000-0000-0000-000000000002';

const prodotto = (i: number, seller: string) => ({
  id: `p-${i}`, name: `P${i}`, price: 4, compare_at_price: null, images: [], stock: 3, has_variants: false,
  created_at: '2026-11-10T10:00:00Z', seller_id: seller, category_id: null, status: 'available',
});

// Quello che vede chi la regola del database lascia leggere anche il negozio in attesa: i prodotti
// arrivano tutti, ma la vista pubblica dei negozi ha solo quello approvato (WHERE is_approved).
const mondo = () => ({
  products: [
    ...Array.from({ length: 3 }, (_, i) => prodotto(i, APPROVATO)),
    ...Array.from({ length: 4 }, (_, i) => prodotto(100 + i, IN_ATTESA)),
  ],
  seller_public_profiles: [{ id: APPROVATO, store_name: 'Bottega', store_hours: null, is_approved: true }],
});

describe('R01-013 il conteggio delle Novità e i negozi approvati', () => {
  it('non conta i prodotti di un negozio non approvato', async () => {
    const db = fintoConAgganci(mondo());
    const n = await contaProdottiDellaGriglia(db.client, { creatiDal: '2026-10-30T09:00:00.000Z' });
    expect(n).toBe(3);
  });

  it('il numero in alto è uguale alle schede che la lettura mostra', async () => {
    const db = fintoConAgganci(mondo());
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 96, creatiDal: '2026-10-30T09:00:00.000Z' });
    const n = await contaProdottiDellaGriglia(db.client, { creatiDal: '2026-10-30T09:00:00.000Z' });
    expect(righe).toHaveLength(3);
    expect(n).toBe(righe.length);
  });

  it('il filtro sta dentro la domanda del conteggio, che resta una sola e senza righe', async () => {
    const db = fintoConAgganci(mondo());
    await contaProdottiDellaGriglia(db.client, {});
    const conteggi = db.chiamate.filter((c) => c.conteggio);
    expect(conteggi).toHaveLength(1);
    expect(conteggi[0].tabella).toBe('products');
    expect(conteggi[0].colonne).toMatch(/seller_public_profiles!inner\(/);
  });
});
