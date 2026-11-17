/**
 * R02-011 — NELLA PAGINA NOVITÀ IL NUMERO IN ALTO CONTAVA ANCHE PRODOTTI CHE LA GRIGLIA NON MOSTRA.
 *
 * La griglia tiene solo i prodotti dei negozi che la vista pubblica `seller_public_profiles`
 * restituisce (approvati, con insegna); il conteggio contava tutti quelli con gli altri filtri.
 * Qui lettura e conteggio veri girano sullo stesso database finto, che sa fare l'aggancio
 * `seller_public_profiles!inner` come PostgREST (la riga senza negozio in vetrina non esce): il
 * numero deve essere quello delle schede che la griglia mostra. Se il servizio dati non conosce
 * l'aggancio (PGRST200) si conta come prima, invece di non dare un numero.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb, type Tabelle } from './aiuti/finto-postgrest';
import { contaProdottiDellaGriglia, leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import type { SupabaseClient } from '@supabase/supabase-js';

const APPROVATO = { id: '22222222-2222-2222-2222-000000000001', store_name: 'Forno', store_hours: null, is_approved: true };
const FUORI_VETRINA = '22222222-2222-2222-2222-000000000009';
const DAL = '2026-11-03T10:00:00.000Z';

const riga = (i: number, negozio: string, creato: string) => ({
  id: `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`, name: `P${i}`, price: 4, compare_at_price: null,
  images: [], stock: 3, has_variants: false, created_at: creato, seller_id: negozio, category_id: null, status: 'available',
});

function catalogo(): Tabelle {
  return {
    // La vista restituisce solo il negozio in vetrina: l'altro non c'è.
    seller_public_profiles: [APPROVATO],
    products: [
      ...Array.from({ length: 10 }, (_, i) => riga(i, APPROVATO.id, '2026-11-10T10:00:00Z')),
      ...Array.from({ length: 3 }, (_, i) => riga(100 + i, FUORI_VETRINA, '2026-11-11T10:00:00Z')),
      ...Array.from({ length: 5 }, (_, i) => riga(200 + i, APPROVATO.id, '2026-09-01T10:00:00Z')),
    ],
  };
}

/** Il finto PostgREST, con l'aggancio `!inner` alla vista dei negozi sui prodotti. */
function conAggancioAllaVista(db: ReturnType<typeof fintoDb>, tabelle: Tabelle, opz: { sconosciuto?: boolean } = {}) {
  const inVetrina = (tabelle.seller_public_profiles ?? []).map((n) => n.id);
  const client = {
    ...db.client,
    from: (tabella: string) => {
      const q = db.client.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const vero = q.select.bind(q);
      q.select = (colonne: unknown, opzioni: unknown) => {
        const r = vero(colonne, opzioni) as Record<string, (...a: unknown[]) => unknown>;
        if (tabella === 'products' && /seller_public_profiles!inner/.test(String(colonne))) {
          if (opz.sconosciuto) {
            // PostgREST che non conosce la relazione: errore su tutta la domanda.
            const fallita: Record<string, (...a: never[]) => unknown> = {
              then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: { code: 'PGRST200', message: 'Could not find a relationship' } }).then(ok),
            };
            for (const m of ['eq', 'in', 'lte', 'gte', 'or', 'ilike']) fallita[m] = () => fallita;
            return fallita;
          }
          r.in('seller_id', inVetrina);
        }
        return r;
      };
      return q;
    },
  };
  return client as unknown as SupabaseClient;
}

describe('R02-011 · il numero sopra «Novità» conta quello che la griglia mostra', () => {
  it('i prodotti di un negozio fuori vetrina non entrano nel numero', async () => {
    const tabelle = catalogo();
    const client = conAggancioAllaVista(fintoDb(tabelle), tabelle);
    const righe = await leggiProdottiDellaGriglia(client, { sort: 'newest', tetto: 96, creatiDal: DAL });
    const n = await contaProdottiDellaGriglia(client, { creatiDal: DAL });
    expect(righe).toHaveLength(10);
    expect(n, 'il numero in alto conta prodotti che la griglia non mostra').toBe(righe.length);
  });

  it('servizio dati che non conosce l aggancio: si conta come prima, non «non lo so»', async () => {
    const tabelle = catalogo();
    const client = conAggancioAllaVista(fintoDb(tabelle), tabelle, { sconosciuto: true });
    const n = await contaProdottiDellaGriglia(client, { creatiDal: DAL });
    expect(n).toBe(13);
  });
});
