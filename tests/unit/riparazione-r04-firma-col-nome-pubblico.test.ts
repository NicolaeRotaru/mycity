import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R04 — Nelle recensioni della vetrina chi ha solo il nome pubblico (handle, senza nome vero)
 * appariva come «Cliente»: la lettura dei nomi passava solo dalla vista `nomi_pubblici`, che dà la
 * prima parola del nome vero. Torna il ripiego: prima parola del nome vero, se manca il nome
 * pubblico, se manca anche quello nessun nome (la vetrina scrive «Cliente»).
 *
 * Il hook vero gira contro un database finto (il client finto delle prove con
 * `__CLIENT_SUPABASE__`) e una rotta finta degli handle pubblici; la `queryFn` delle recensioni
 * si raccoglie dal finto di react-query qui sotto.
 */

type Opzioni = { queryKey: readonly unknown[]; queryFn?: () => Promise<unknown> };
const stato = vi.hoisted(() => ({ chieste: [] as Array<{ queryKey: readonly unknown[]; queryFn?: () => Promise<unknown> }> }));

vi.mock('@/lib/supabase/client', () => import('./aiuti/finti/supabase-client.mjs'));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: Opzioni) => {
    stato.chieste.push(o);
    return { data: undefined, isError: false, isLoading: false, refetch: () => undefined };
  },
}));

// Il hook si chiama come una funzione: il finto di react-query qui sopra non usa lo stato di React.
import { useStorePageData as datiDelNegozio } from '@/components/store-sections/useStorePageData';

const NEGOZIO = 'negozio-1';
const RECENSIONI = [
  { id: 'r1', rating: 5, comment: 'Ottimo', created_at: '2026-11-10T10:00:00Z', seller_reply: null, user_id: 'u-anna', order_id: null, photo_urls: null, helpful_count: 0 },
  { id: 'r2', rating: 4, comment: 'Buono', created_at: '2026-11-09T10:00:00Z', seller_reply: null, user_id: 'u-gigi', order_id: null, photo_urls: null, helpful_count: 0 },
  { id: 'r3', rating: 3, comment: 'Così', created_at: '2026-11-08T10:00:00Z', seller_reply: null, user_id: 'u-nessuno', order_id: null, photo_urls: null, helpful_count: 0 },
];
/** La vista dei nomi: solo chi ha un nome vero (Gigi e il terzo non l'hanno scritto). */
const NOMI = [{ id: 'u-anna', nome: 'Anna' }];
/** Gli handle di chi ha acceso il profilo pubblico: Gigi sì, il terzo no. */
const HANDLE = [{ id: 'u-gigi', public_handle: 'gigi_del_forno' }];

function databaseFinto() {
  return {
    from: (tavola: string) => {
      const filtri: Array<[string, unknown]> = [];
      const righe = () => {
        if (tavola === 'store_reviews') return RECENSIONI;
        if (tavola === 'nomi_pubblici') {
          const ids = (filtri.find(([c]) => c === 'id')?.[1] ?? []) as string[];
          return NOMI.filter((n) => ids.includes(n.id));
        }
        return [];
      };
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'range']) c[m] = () => c;
      c.in = (colonna: string, valori: unknown) => { filtri.push([colonna, valori]); return c; };
      c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: righe(), error: null }).then(ok, ko);
      return c;
    },
  };
}

const chiamateRotta: string[] = [];
function rottaDegliHandle(rotta: 'risponde' | 'cade') {
  return vi.fn(async (indirizzo: string) => {
    chiamateRotta.push(indirizzo);
    if (rotta === 'cade') throw new Error('rete');
    const ids = new URL(indirizzo, 'http://sito.test').searchParams.getAll('id');
    return { ok: true, status: 200, json: async () => ({ ok: true, data: HANDLE.filter((h) => ids.includes(h.id)) }) };
  });
}

async function firme(): Promise<Array<string | null>> {
  stato.chieste.length = 0;
  datiDelNegozio(NEGOZIO);
  const recensioni = stato.chieste.find((o) => JSON.stringify(o.queryKey).includes(NEGOZIO) && /review/i.test(JSON.stringify(o.queryKey)) && !JSON.stringify(o.queryKey).includes('riepilogo'));
  expect(recensioni, 'la lettura delle recensioni del negozio').toBeTruthy();
  const righe = (await recensioni!.queryFn!()) as Array<{ author: string | null }>;
  return righe.map((r) => r.author);
}

const g = globalThis as { __CLIENT_SUPABASE__?: unknown };
beforeEach(() => {
  chiamateRotta.length = 0;
  g.__CLIENT_SUPABASE__ = databaseFinto();
});
afterEach(() => {
  delete g.__CLIENT_SUPABASE__;
  vi.unstubAllGlobals();
});

describe('R04 — le recensioni della vetrina firmano col nome pubblico quando manca il nome vero', () => {
  it('nome vero → la prima parola; solo il nome pubblico → il nome pubblico; nessuno dei due → nessun nome («Cliente»)', async () => {
    vi.stubGlobal('fetch', rottaDegliHandle('risponde'));
    expect(await firme()).toEqual(['Anna', 'gigi_del_forno', null]);
  });

  it('il nome pubblico si chiede solo per chi non ha il nome vero', async () => {
    vi.stubGlobal('fetch', rottaDegliHandle('risponde'));
    await firme();
    expect(chiamateRotta).toHaveLength(1);
    const ids = new URL(chiamateRotta[0], 'http://sito.test').searchParams.getAll('id');
    expect(ids.sort()).toEqual(['u-gigi', 'u-nessuno']);
  });

  it('se la lettura dei nomi pubblici cade, le recensioni restano con i nomi veri e le altre senza nome', async () => {
    vi.stubGlobal('fetch', rottaDegliHandle('cade'));
    expect(await firme()).toEqual(['Anna', null, null]);
  });
});
