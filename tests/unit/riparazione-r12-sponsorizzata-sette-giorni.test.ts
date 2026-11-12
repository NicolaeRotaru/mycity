/**
 * R12-019 — La vetrina sponsorizzata di una settimana restava in vetrina 8
 * giorni: la fine era «oggi + 7» e la vetrina conta entrambi gli estremi.
 * Orologio finto: lunedì 16/11/2026 alle 10 a Piacenza.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scritte: Array<Record<string, unknown>> = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => ({
      insert: async (riga: Record<string, unknown>) => {
        scritte.push({ tabella, ...riga });
        return { error: null };
      },
    }),
  }),
}));

import { handleSponsoredPurchase } from '@/lib/stripe/webhook/sponsorizzati';

const sessione = (days: string) =>
  ({
    id: `cs_${days}`,
    amount_total: 700,
    metadata: { kind: 'sponsored', seller_id: 'negozio-1', product_id: 'prod-1', days, amount_cents: '700' },
  }) as unknown as Parameters<typeof handleSponsoredPurchase>[0];

/** Giorni di calendario in vetrina, estremi compresi (come fa la vetrina). */
function giorniInVetrina(inizio: string, fine: string): number {
  return Math.round((Date.parse(`${fine}T12:00:00Z`) - Date.parse(`${inizio}T12:00:00Z`)) / 86_400_000) + 1;
}

beforeEach(() => {
  scritte.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T09:00:00.000Z')); // 10:00 a Piacenza
});
afterEach(() => vi.useRealTimers());

describe('R12-019 una settimana di vetrina dura sette giorni', () => {
  it('comprata lunedì 16 alle 10: dal 16 al 22 compresi, e l avviso dice «fino al 22»', async () => {
    await handleSponsoredPurchase(sessione('7'));
    const riga = scritte.find((s) => s.tabella === 'sponsored_listings')!;
    expect(riga.start_date).toBe('2026-11-16');
    expect(riga.end_date).toBe('2026-11-22');
    expect(giorniInVetrina(String(riga.start_date), String(riga.end_date))).toBe(7);
    const avviso = scritte.find((s) => s.tabella === 'notifications')!;
    expect(String(avviso.body)).toContain('fino al 2026-11-22');
  });

  it('quattro settimane: 28 giorni, non 29', async () => {
    await handleSponsoredPurchase(sessione('28'));
    const riga = scritte.find((s) => s.tabella === 'sponsored_listings')!;
    expect(giorniInVetrina(String(riga.start_date), String(riga.end_date))).toBe(28);
  });

  it('a cavallo del cambio d ora restano sette giorni (ottobre e marzo)', async () => {
    for (const quando of ['2026-10-21T22:30:00.000Z', '2027-03-26T22:30:00.000Z']) {
      scritte.length = 0;
      vi.setSystemTime(new Date(quando));
      await handleSponsoredPurchase(sessione('7'));
      const riga = scritte.find((s) => s.tabella === 'sponsored_listings')!;
      expect(giorniInVetrina(String(riga.start_date), String(riga.end_date)), quando).toBe(7);
    }
  });
});
