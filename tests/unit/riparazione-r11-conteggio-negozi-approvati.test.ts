/**
 * R11-010 R11-011 — Il numero sopra la griglia (Novità comprese) conta solo i prodotti dei negozi
 * approvati. Qui si usa il client VERO di supabase-js con un `fetch` finto che risponde come
 * PostgREST su una richiesta HEAD:
 *  - aggancio alla vista SENZA nome del vincolo → 300 e corpo vuoto (PGRST201): postgrest-js su una
 *    HEAD non dà il codice, dà solo `{ message: "" }`;
 *  - aggancio col nome del vincolo → `content-range` coi soli approvati;
 *  - senza aggancio → `content-range` con tutti.
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { contaProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';

const APPROVATO = 'a1';
const PRODOTTI = [
  { id: 'p1', seller_id: APPROVATO, created_at: '2026-11-20T10:00:00Z' },
  { id: 'p2', seller_id: 'x9', created_at: '2026-11-20T09:00:00Z' },
  { id: 'p3', seller_id: APPROVATO, created_at: '2026-11-19T09:00:00Z' },
  { id: 'p4', seller_id: 'x9', created_at: '2026-10-01T09:00:00Z' },
];

type Modo = 'normale' | 'vincoloSbagliato';

function clientFinto(modo: Modo = 'normale') {
  const richieste: string[] = [];
  const fetchFinto = async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const select = url.searchParams.get('select') ?? '';
    richieste.push(select);
    let righe = [...PRODOTTI];
    const gte = url.searchParams.get('created_at');
    if (gte?.startsWith('gte.')) righe = righe.filter((r) => r.created_at >= gte.slice(4));
    if (select.includes('seller_public_profiles')) {
      if (!select.includes('!products_seller_id_fkey!')) return new Response(null, { status: 300 });
      if (modo === 'vincoloSbagliato') return new Response(null, { status: 400 });
      righe = righe.filter((r) => r.seller_id === APPROVATO);
    }
    return new Response(null, { status: 200, headers: { 'content-range': `*/${righe.length}` } });
  };
  const client = createClient('http://finto.local', 'chiave-finta', { global: { fetch: fetchFinto as typeof fetch } });
  return { client: client as never, richieste };
}

describe('R11-010 R11-011 · il conteggio sceglie i negozi approvati', () => {
  it('conta solo i prodotti dei negozi approvati, nominando il vincolo', async () => {
    const { client, richieste } = clientFinto();
    expect(await contaProdottiDellaGriglia(client, {})).toBe(2);
    expect(richieste).toHaveLength(1);
  });
  it('anche nelle novità (creatiDal)', async () => {
    const { client } = clientFinto();
    expect(await contaProdottiDellaGriglia(client, { creatiDal: '2026-11-01T00:00:00Z' })).toBe(2);
  });
  it('se anche la lettura col vincolo sbaglia (400 senza codice) dà il numero senza aggancio, mai null', async () => {
    const { client, richieste } = clientFinto('vincoloSbagliato');
    expect(await contaProdottiDellaGriglia(client, {})).toBe(4);
    expect(richieste).toHaveLength(2);
    expect(richieste[1]).toBe('id');
  });
  it('idem nelle novità', async () => {
    const { client } = clientFinto('vincoloSbagliato');
    expect(await contaProdottiDellaGriglia(client, { creatiDal: '2026-11-01T00:00:00Z' })).toBe(3);
  });
});
