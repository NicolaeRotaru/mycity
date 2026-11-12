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
const registro = vi.hoisted(() => ({ righe: new Map<string, string>() }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: (...a: unknown[]) => rpcMock(...a),
    // operational_alert_log finta: solo le colonne vere, alert_key e last_sent_at.
    from: () => ({
      upsert: async (riga: { alert_key: string; last_sent_at: string }, o: { ignoreDuplicates?: boolean }) => {
        if (!(o?.ignoreDuplicates && registro.righe.has(riga.alert_key))) registro.righe.set(riga.alert_key, riga.last_sent_at);
        return { error: null };
      },
      select: () => ({
        eq: (_c: string, k: string) => ({
          maybeSingle: async () => ({ data: registro.righe.has(k) ? { last_sent_at: registro.righe.get(k) } : null, error: null }),
        }),
      }),
      delete: () => ({ eq: async (_c: string, k: string) => { registro.righe.delete(k); return { error: null }; } }),
    }),
  }),
}));

import {
  sondaContoCondiviso,
  allarmiTettoSpesaAi,
  allarmiTettoSpesaAiPerIlCron,
  CHIAVE_RIPIEGO_DA,
  __azzeraRipiegoSpesaAi,
} from '@/lib/ai/tettoSpesa';

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

describe('l\'allarme per il cron ricorda l\'inizio del guasto nel database (revisione K02)', () => {
  beforeEach(() => {
    __azzeraRipiegoSpesaAi();
    rpcMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    registro.righe.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('primo giro: scrive l\'inizio; un giro due ore dopo, su una copia nuova, l\'allarme e\' rosso', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    expect(await allarmiTettoSpesaAiPerIlCron({ tettoEur: 20 })).toHaveLength(0);
    expect(registro.righe.get(CHIAVE_RIPIEGO_DA)).toBe('2026-11-12T10:00:00.000Z');
    __azzeraRipiegoSpesaAi(); // copia nuova: la memoria riparte da zero
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    const allarmi = await allarmiTettoSpesaAiPerIlCron({ tettoEur: 20 });
    expect(allarmi).toHaveLength(1);
    // L'inizio non si sposta ai giri successivi.
    expect(registro.righe.get(CHIAVE_RIPIEGO_DA)).toBe('2026-11-12T10:00:00.000Z');
  });

  it('quando il conto torna a rispondere la riga si toglie e non c\'e\' allarme', async () => {
    registro.righe.set(CHIAVE_RIPIEGO_DA, '2026-11-12T06:00:00.000Z');
    rpcMock.mockResolvedValue({ data: 100, error: null });
    expect(await allarmiTettoSpesaAiPerIlCron({ tettoEur: 20 })).toHaveLength(0);
    expect(registro.righe.has(CHIAVE_RIPIEGO_DA)).toBe(false);
  });
});
