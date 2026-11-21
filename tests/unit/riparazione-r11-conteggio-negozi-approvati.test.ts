/**
 * R11-010 R11-011 — Il numero sopra la griglia (Novità comprese) conta solo i prodotti dei negozi
 * approvati, gli stessi che la griglia mostra. Il finto qui sotto fa quello che fa PostgREST con
 * `seller_public_profiles!inner(...)`: scarta le righe il cui negozio non è nella vista.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contaProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';

const APPROVATO = 'a1';
const FUORI = 'x9';
const PRODOTTI = [
  { id: 'p1', seller_id: APPROVATO, created_at: '2026-11-20T10:00:00Z' },
  { id: 'p2', seller_id: FUORI, created_at: '2026-11-20T09:00:00Z' },
  { id: 'p3', seller_id: APPROVATO, created_at: '2026-11-19T09:00:00Z' },
  { id: 'p4', seller_id: FUORI, created_at: '2026-10-01T09:00:00Z' },
];

function finto(opzioni: { senzaAggancio?: boolean } = {}) {
  const chiamate: string[] = [];
  const client = {
    from() {
      let colonne = '';
      let righe = [...PRODOTTI];
      const q = {
        select(c: string) { colonne = c; chiamate.push(c); return q; },
        eq() { return q; },
        in() { return q; },
        gte(col: string, v: string) { righe = righe.filter((r) => (r as Record<string, string>)[col] >= v); return q; },
        then(ok: (v: unknown) => unknown) {
          if (colonne.includes('!inner')) {
            if (opzioni.senzaAggancio) return Promise.resolve(ok({ count: null, error: { code: 'PGRST200', message: 'no relationship' } }));
            righe = righe.filter((r) => r.seller_id === APPROVATO);
          }
          return Promise.resolve(ok({ count: righe.length, error: null }));
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, chiamate };
}

describe('R11-010 R11-011 · il conteggio sceglie i negozi approvati', () => {
  it('conta solo i prodotti dei negozi approvati', async () => {
    const { client } = finto();
    expect(await contaProdottiDellaGriglia(client, {})).toBe(2);
  });
  it('anche nelle novità (creatiDal)', async () => {
    const { client } = finto();
    expect(await contaProdottiDellaGriglia(client, { creatiDal: '2026-11-01T00:00:00Z' })).toBe(2);
  });
  it('se il servizio non conosce l aggancio si conta come prima, senza dare null', async () => {
    const { client, chiamate } = finto({ senzaAggancio: true });
    expect(await contaProdottiDellaGriglia(client, {})).toBe(4);
    expect(chiamate).toHaveLength(2);
  });
});
