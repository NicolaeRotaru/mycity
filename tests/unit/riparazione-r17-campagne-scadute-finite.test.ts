import { describe, it, expect, afterEach, vi } from 'vitest';
import { vistaDelleCampagne, type Campagna } from '@/lib/admin/vista-delle-campagne';

/** R17-008 — una campagna oltre la data di fine si mostra e si filtra come «finita». */
afterEach(() => vi.useRealTimers());

const camp = (status: Campagna['status'], end_date: string): Campagna => ({
  id: 'c1', product_id: 'p', seller_id: 's', placement: 'home_top', category_slug: null,
  start_date: '2026-11-16', end_date, daily_budget_cents: 100, spent_cents: 0, impressions: 0, clicks: 0,
  status, product: { name: 'Pane' }, seller: { store_name: 'Forno' },
});
const stato = (c: Campagna) =>
  vistaDelleCampagne({ data: { campagne: [c], totale: 1 }, isPending: false, isError: false, error: null } as never, 'all').campagne[0].status;

describe('R17-008 — campagne scadute', () => {
  it('active con fine passata (giorno di Piacenza) si mostra finita', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
    expect(stato(camp('active', '2026-11-23'))).toBe('ended');
  });
  it('il giorno di fine e\' ancora attiva; la pausa resta pausa', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T21:00:00Z'));
    expect(stato(camp('active', '2026-11-23'))).toBe('active');
    expect(stato(camp('paused', '2026-11-01'))).toBe('paused');
  });
  it('a mezzanotte di Piacenza scatta il giorno dopo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T23:30:00Z'));
    expect(stato(camp('active', '2026-11-23'))).toBe('ended');
  });
});
