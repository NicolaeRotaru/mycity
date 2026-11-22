import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La 404 della scheda prodotto si decide con le regole di lettura di chi apre la pagina; senza le
 * regole se ne usa solo la risposta «non disponibile» (finito, esaurito o venduto, in un negozio
 * approvato). Tutto il resto, per chi non lo vede, è una 404 come un prodotto che non c'è.
 */

const ID = '0b4f1c1e-1111-4222-8333-944455556666';

const mondo = vi.hoisted(() => ({
  /** La riga come la vede chi apre la pagina (null: con le sue regole non la vede). */
  vistaDallaSessione: null as Record<string, unknown> | null,
  erroreDellaSessione: null as null | { code: string; message: string },
  /** La riga com'è, senza regole (null: non esiste). */
  riga: null as Record<string, unknown> | null,
  negozio: null as Record<string, unknown> | null,
  erroreDelNegozio: null as null | { code: string; message: string },
  domandeSenzaRegole: 0,
}));

vi.mock('@/lib/supabase/lettura-per-metadati', () => ({ leggiPerMetadati: async () => null }));
vi.mock('@/lib/queries/precarico', () => ({
  precaricaProdotto: async () => ({ mutations: [], queries: [] }),
  precaricaNegozio: async () => ({ mutations: [], queries: [] }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => {
  const domanda = (risposta: () => { data: unknown; error: unknown }) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => risposta() };
    return q;
  };
  return {
    getServerSupabase: async () => ({
      from: () => domanda(() => ({ data: mondo.vistaDallaSessione, error: mondo.erroreDellaSessione })),
    }),
    getAdminSupabase: () => ({
      from: (tabella: string) => domanda(() => {
        mondo.domandeSenzaRegole++;
        if (tabella === 'profiles') return { data: mondo.negozio, error: mondo.erroreDelNegozio };
        return { data: mondo.riga, error: null };
      }),
    }),
  };
});

const { default: ProductLayout } = await import('@/app/product/[id]/layout');

async function rispondeNonTrovato(): Promise<boolean> {
  try {
    await ProductLayout({ children: 'pagina', params: Promise.resolve({ id: ID }) });
    return false;
  } catch (e) {
    const digest = (e as { digest?: unknown })?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404')) return true;
    throw e;
  }
}

const APPROVATO = { role: 'seller', is_approved: true };
const SOSPESO = { role: 'seller', is_approved: false };
const riga = (status: string) => ({ id: ID, status, seller_id: 'n1' });

beforeEach(() => {
  mondo.vistaDallaSessione = null;
  mondo.erroreDellaSessione = null;
  mondo.riga = null;
  mondo.negozio = APPROVATO;
  mondo.erroreDelNegozio = null;
  mondo.domandeSenzaRegole = 0;
});

describe('chi non può vedere il prodotto', () => {
  it('una bozza risponde 404, come un prodotto che non c\'è', async () => {
    mondo.riga = riga('draft');
    expect(await rispondeNonTrovato()).toBe(true);
  });

  it('un prodotto in approvazione risponde 404', async () => {
    mondo.riga = riga('pending_approval');
    expect(await rispondeNonTrovato()).toBe(true);
  });

  it('un prodotto in vendita di un negozio sospeso risponde 404', async () => {
    mondo.riga = riga('available');
    mondo.negozio = SOSPESO;
    expect(await rispondeNonTrovato()).toBe(true);
  });

  it('un prodotto finito di un negozio sospeso risponde 404', async () => {
    mondo.riga = riga('out_of_stock');
    mondo.negozio = SOSPESO;
    expect(await rispondeNonTrovato()).toBe(true);
  });

  it('le risposte di bozza, negozio sospeso e prodotto che non c\'è sono uguali', async () => {
    mondo.riga = null;
    const nonCe = await rispondeNonTrovato();
    mondo.riga = riga('draft');
    const bozza = await rispondeNonTrovato();
    mondo.riga = riga('available');
    mondo.negozio = SOSPESO;
    const sospeso = await rispondeNonTrovato();
    expect([nonCe, bozza, sospeso]).toEqual([true, true, true]);
  });

  it('controprova: finito per oggi, esaurito o venduto in un negozio approvato NON è una 404', async () => {
    for (const status of ['out_of_stock', 'sold_out', 'sold']) {
      mondo.riga = riga(status);
      expect(await rispondeNonTrovato(), status).toBe(false);
    }
  });
});

describe('chi può vedere il prodotto con le sue regole', () => {
  it('il negoziante che apre la propria bozza non prende 404, e non si chiede niente senza regole', async () => {
    mondo.vistaDallaSessione = { id: ID };
    mondo.riga = riga('draft');
    expect(await rispondeNonTrovato()).toBe(false);
    expect(mondo.domandeSenzaRegole).toBe(0);
  });
});

describe('mai una 404 per un guasto', () => {
  it('se la domanda con la sessione non riesce, niente 404', async () => {
    mondo.erroreDellaSessione = { code: '57014', message: 'canceling statement due to statement timeout' };
    mondo.riga = riga('draft');
    expect(await rispondeNonTrovato()).toBe(false);
  });

  it('se la domanda sul negozio non riesce, niente 404', async () => {
    mondo.riga = riga('out_of_stock');
    mondo.erroreDelNegozio = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(await rispondeNonTrovato()).toBe(false);
  });
});
