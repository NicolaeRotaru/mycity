/**
 * R06-006 (12/11/2026) — OLTRE I MILLE PRODOTTI LA MAPPA PER GOOGLE PERDEVA I PIU' VECCHI.
 *
 * La sitemap leggeva i prodotti con una richiesta per blocco di cento negozi e
 * `.limit(5000)`, e i negozi con `.limit(2000)`. Il database pero' non consegna
 * piu' di mille righe per richiesta: oltre, i prodotti caricati per primi e i
 * negozi in fondo all'elenco sparivano dalla mappa senza nessun errore.
 *
 * Qui sitemap() gira contro un finto database col tetto vero di mille righe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaPostgrestColTetto, type Riga } from './aiuti/riparazione-r06-postgrest-col-tetto';

const stato: { client: unknown } = { client: null };
vi.mock('@/lib/supabase/anonimo', () => ({ creaClientAnonimo: () => stato.client }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://finto.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chiave-finta');
});
afterEach(() => { vi.unstubAllEnvs(); });

function prodotti(negozio: string, n: number, base = 0): Riga[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p-${negozio}-${i}`,
    seller_id: negozio,
    status: 'available',
    category_id: null,
    created_at: new Date(Date.UTC(2026, 0, 1) + (base + i) * 60_000).toISOString(),
  }));
}

describe('R06-006 · la sitemap oltre le mille righe', () => {
  it('un negozio con 1059 prodotti: tutti e 1059 nella mappa', async () => {
    stato.client = creaPostgrestColTetto({
      seller_public_profiles: [{ id: 'negozio-1', created_at: '2026-01-01T00:00:00Z' }],
      categories: [],
      products: prodotti('negozio-1', 1059),
    }).client;
    const { default: sitemap } = await import('@/app/sitemap');
    const voci = await sitemap();
    const prodottiInMappa = voci.filter((v) => v.url.includes('/product/'));
    expect(prodottiInMappa.length, 'La mappa si e\' fermata ai primi mille prodotti: i piu\' vecchi non arrivano a Google').toBe(1059);
    expect(prodottiInMappa.some((v) => v.url.endsWith('/product/p-negozio-1-0'))).toBe(true);
  });

  it('1200 negozi: tutti e 1200 nella mappa', async () => {
    const negozi = Array.from({ length: 1200 }, (_, i) => ({ id: `n-${String(i).padStart(4, '0')}`, created_at: '2026-01-01T00:00:00Z' }));
    stato.client = creaPostgrestColTetto({ seller_public_profiles: negozi, categories: [], products: [] }).client;
    const { default: sitemap } = await import('@/app/sitemap');
    const voci = await sitemap();
    expect(voci.filter((v) => v.url.includes('/store/')).length, 'I negozi oltre il millesimo mancavano dalla mappa').toBe(1200);
  });

  it('il tetto dei 5000 indirizzi di prodotto resta', async () => {
    stato.client = creaPostgrestColTetto({
      seller_public_profiles: [{ id: 'a', created_at: '2026-01-01T00:00:00Z' }],
      categories: [],
      products: prodotti('a', 5300),
    }).client;
    const { default: sitemap } = await import('@/app/sitemap');
    const voci = await sitemap();
    expect(voci.filter((v) => v.url.includes('/product/')).length).toBe(5000);
  });
});
