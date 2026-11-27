import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Il giro dei prezzi esterni: i prodotti in errore ripresi dalla via dei falliti consumavano il
 * permesso di riprovare (il freno delle sei ore) gia' in selezione. Se il giro poi li lasciava
 * fuori (tempo finito, modello mancante) restavano fermi altre sei ore senza essere ritentati.
 * Adesso il permesso si consuma solo per i prodotti che il giro elabora davvero. Orologio finto.
 */
type Riga = {
  id: string; name: string; seller_id: string | null; external_marketplace: null; external_source_url: string;
  external_synced_at: string | null; external_sync_status: string | null; external_data: { price: number; source_title: string };
};
const stato = vi.hoisted(() => ({
  righe: [] as Riga[],
  controllati: [] as string[],
  permessiChiesti: [] as string[],
  durataChiamataMs: 0,
}));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => {
  const vero = await orig<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, AI_NEGOZI_ACCESA: true };
});
vi.mock('@/lib/env', async (orig) => {
  const vero = await orig<typeof import('@/lib/env')>();
  return { ...vero, env: { ...vero.env, anthropicKey: () => 'sk-test' } };
});
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/products/externalSync', () => ({
  fetchExternalSnapshot: async (query: string) => {
    stato.controllati.push(query);
    vi.setSystemTime(Date.now() + stato.durataChiamataMs);
    return { price: 10, external: { price: 10, availability: 'in_stock' } };
  },
  ritentoDopoErroreConsentito: async (id: string) => {
    stato.permessiChiesti.push(id);
    return true;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let filtro: 'sani' | 'falliti' | null = null;
      let aggiornamento: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, not: () => q, order: () => q, limit: () => q, insert: async () => ({ error: null }),
        or: () => { filtro = 'sani'; return q; },
        eq: (c: string, v: unknown) => {
          if (aggiornamento) { aggiornamento = null; return Promise.resolve({ error: null }); }
          if (c === 'external_sync_status' && v === 'error') filtro = 'falliti';
          return q;
        },
        update: (v: Record<string, unknown>) => { aggiornamento = v; return q; },
        then: (ok: (x: unknown) => void) => {
          const data = stato.righe.filter((r) =>
            filtro === 'falliti' ? r.external_sync_status === 'error' : filtro === 'sani' ? r.external_sync_status !== 'error' : true);
          ok({ data, error: null });
        },
      });
      return q;
    },
  }),
}));

const riga = (id: string, statoSync: string): Riga => ({
  id, name: id, seller_id: null, external_marketplace: null, external_source_url: 'https://x',
  external_synced_at: null, external_sync_status: statoSync, external_data: { price: 10, source_title: id },
});

async function giro(): Promise<Record<string, unknown>> {
  const { GET } = await import('@/app/api/cron/external-price-alerts/route');
  return (await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'))).json();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  stato.righe = []; stato.controllati.length = 0; stato.permessiChiesti.length = 0; stato.durataChiamataMs = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('il permesso di riprovare dei prodotti in errore', () => {
  it('un fallito che il giro lascia fuori per il tempo non consuma il permesso delle sei ore', async () => {
    // Quattro sani da 60 s l'uno riempiono il tempo del giro (270 s): i falliti restano fuori.
    stato.durataChiamataMs = 60_000;
    stato.righe = [riga('ok0', 'idle'), riga('ok1', 'idle'), riga('ok2', 'idle'), riga('ok3', 'idle'), riga('err0', 'error'), riga('err1', 'error')];
    const r = await giro();
    expect(stato.controllati).toEqual(['ok0', 'ok1', 'ok2', 'ok3']);
    expect(stato.permessiChiesti).toEqual([]);
    expect(r.rimasti).toBe(2);
  });

  it('un fallito che il giro elabora davvero consuma il permesso, una volta sola', async () => {
    stato.righe = [riga('ok0', 'idle'), riga('err0', 'error')];
    await giro();
    expect(stato.controllati).toEqual(['ok0', 'err0']);
    expect(stato.permessiChiesti).toEqual(['err0']);
  });
});
