import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S01 — 29: se la lettura delle promozioni non risponde, l'ordine non passa a
 * prezzo pieno in silenzio: il guasto si scrive nel log e la mappa porta il segno
 * che le due rotte della cassa usano per rispondere 503.
 */
const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: log }));
import { fetchActiveDiscounts, type MappaSconti } from '@/lib/promotions';

const client = (rpc: (nome: string) => { data: unknown; error: unknown }) => ({ rpc: async (n: string) => rpc(n) }) as never;

describe('29 — sconti non letti', () => {
  it('tutte e due le letture cadono: segno acceso e riga nel log', async () => {
    const m: MappaSconti = await fetchActiveDiscounts(client(() => ({ data: null, error: { message: 'timeout' } })), ['p1', 'p2']);
    expect(m.scontiNonLetti).toBe(true);
    expect(log.warn).toHaveBeenCalled();
  });
  it('funzione unica mancante ma singoli letti: nessun segno, sconti giusti', async () => {
    const m: MappaSconti = await fetchActiveDiscounts(
      client((n) => (n === 'product_active_discounts' ? { data: null, error: { code: 'PGRST202', message: 'x' } } : { data: 20, error: null })),
      ['p1'],
    );
    expect(m.scontiNonLetti).toBeUndefined();
    expect(m.get('p1')).toBe(20);
  });
  it('le due rotte della cassa si fermano col segno acceso', () => {
    for (const p of ['app/api/stripe/checkout/route.ts', 'app/api/orders/cod/route.ts']) {
      expect(readFileSync(p, 'utf8')).toMatch(/\(discountMap as MappaSconti\)\.scontiNonLetti === true\) \{\s*\n\s*return .*ApiErrors\.unavailable/);
    }
  });
});
