import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R04-018 — L'ora di tolleranza del ripiego si contava solo dalla memoria della
 * singola copia: una copia appena nata ripartiva da zero e l'allarme poteva non
 * arrivare mai. La sonda ora accetta da quando il guasto e' noto (salvato fuori
 * dalla copia, es. dal cron) e l'allarme scatta da qualunque copia.
 */

const rpcMock = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

import { sondaContoCondiviso, allarmiTettoSpesaAi, __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';

describe('l\'allarme del ripiego non dipende dalla vita della copia', () => {
  beforeEach(() => {
    __azzeraRipiegoSpesaAi();
    rpcMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('copia nuova, database che non risponde da due ore (noto al cron): allarme rosso subito', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const dueOreFa = Date.now() - 2 * 60 * 60_000;
    const conto = await sondaContoCondiviso(undefined, dueOreFa);
    expect(conto.condiviso).toBe(false);
    expect(conto.permanente).toBe(false);
    expect(conto.daMinuti).toBeGreaterThanOrEqual(120);
    expect(allarmiTettoSpesaAi(conto, { tettoEur: 20 })).toHaveLength(1);
  });

  it('un istante noto nel futuro o non valido non si prende', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    const conto = await sondaContoCondiviso(undefined, Date.now() + 60 * 60_000);
    expect(conto.daMinuti).toBe(0);
    expect(allarmiTettoSpesaAi(conto, { tettoEur: 20 })).toHaveLength(0);
  });

  it('se il database risponde non c\'e\' nessun allarme, qualunque cosa ricordi il cron', async () => {
    rpcMock.mockResolvedValue({ data: 150, error: null });
    const conto = await sondaContoCondiviso(undefined, Date.now() - 5 * 60 * 60_000);
    expect(conto.condiviso).toBe(true);
    expect(allarmiTettoSpesaAi(conto, { tettoEur: 20 })).toHaveLength(0);
  });
});
