import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R04-011 (revisione) — Il giro a orario dei prezzi esterni segnava
 * external_synced_at=adesso quando l'aggiornamento falliva. Adesso segna solo
 * l'errore; un prodotto in errore si ritenta al massimo ogni sei ore e (K02)
 * non occupa la testa della fila: i prodotti sani si controllano lo stesso.
 */
type Riga = Record<string, unknown> & { id: string; external_sync_status: string | null };
const stato = vi.hoisted(() => ({
  aggiornamenti: [] as Array<Record<string, unknown>>,
  controllati: [] as string[],
  righe: [] as Array<Record<string, unknown> & { id: string; external_sync_status: string | null }>,
  ritento: true,
  falliscono: new Set<string>(),
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
    const r = stato.righe.find((x) => (x.external_data as { source_title: string }).source_title === query)!;
    stato.controllati.push(r.id);
    if (stato.falliscono.has(r.id)) throw new Error('fornitore giu');
    return { price: 10, external: { price: 10, availability: 'in_stock' } };
  },
  ritentoDopoErroreConsentito: async () => stato.ritento,
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
          if (aggiornamento) { stato.aggiornamenti.push({ ...aggiornamento, id: v }); aggiornamento = null; return Promise.resolve({ error: null }); }
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

const riga = (id: string, statoSync: string | null, sincronizzato: string | null): Riga => ({
  id, name: id, seller_id: 's1', external_marketplace: null, external_source_url: 'https://x',
  external_synced_at: sincronizzato, external_sync_status: statoSync, external_data: { price: 10, source_title: id },
});

async function giro() {
  const { GET } = await import('@/app/api/cron/external-price-alerts/route');
  return (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'));
}
beforeEach(() => {
  stato.aggiornamenti.length = 0; stato.controllati.length = 0; stato.righe = []; stato.ritento = true; stato.falliscono.clear();
});

describe('giro dei prezzi esterni quando l\'aggiornamento fallisce', () => {
  it('segna l\'errore senza dire «aggiornato adesso»', async () => {
    stato.righe = [riga('p1', 'idle', null)];
    stato.falliscono.add('p1');
    await giro();
    expect(stato.aggiornamenti).toContainEqual({ external_sync_status: 'error', id: 'p1' });
    expect(stato.aggiornamenti.some((a) => 'external_synced_at' in a)).toBe(false);
  });

  it('un prodotto gia\' in errore, dentro le sei ore, non si ritenta', async () => {
    stato.righe = [riga('p1', 'error', null)];
    stato.ritento = false;
    await giro();
    expect(stato.controllati).toEqual([]);
  });

  it('dieci prodotti sempre in errore, piu\' vecchi di tutti, non tolgono il giro ai sani (K02)', async () => {
    const falliti = Array.from({ length: 10 }, (_, i) => riga(`err${i}`, 'error', null));
    const sani = Array.from({ length: 5 }, (_, i) => riga(`ok${i}`, 'idle', '2026-01-01T00:00:00Z'));
    stato.righe = [...falliti, ...sani];
    falliti.forEach((r) => stato.falliscono.add(r.id));
    await giro();
    expect(stato.controllati.filter((id) => id.startsWith('ok'))).toHaveLength(5);
  });
});
