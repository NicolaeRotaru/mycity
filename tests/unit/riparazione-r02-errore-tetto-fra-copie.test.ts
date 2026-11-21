import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

/**
 * Il freno «un errore all'ora» del conto della spesa AI viveva nella memoria della copia: con la
 * funzione del conto assente, ogni giro del cron su una copia nuova rifaceva l'errore. Ora lo
 * ricorda una riga della tabella degli avvisi (operational_alert_log), uguale per tutte le copie.
 */

const FUNZIONE_ASSENTE = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi' } };
const righe = new Map<string, string>();
const errorMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), spesa: vi.fn(), error: (...a: unknown[]) => errorMock(...a) },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: () => Promise.resolve(FUNZIONE_ASSENTE),
    // operational_alert_log finta, con le sole colonne vere: alert_key e last_sent_at.
    from: () => ({
      upsert: (riga: { alert_key: string; last_sent_at: string }) => ({
        select: () => {
          if (righe.has(riga.alert_key)) return Promise.resolve({ data: [], error: null });
          righe.set(riga.alert_key, riga.last_sent_at);
          return Promise.resolve({ data: [{ alert_key: riga.alert_key }], error: null });
        },
      }),
      update: (nuovo: { last_sent_at: string }) => ({
        eq: (_c: string, chiave: string) => ({
          lt: (_d: string, soglia: string) => ({
            select: () => {
              const ultima = righe.get(chiave);
              if (ultima !== undefined && ultima < soglia) {
                righe.set(chiave, nuovo.last_sent_at);
                return Promise.resolve({ data: [{ alert_key: chiave }], error: null });
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
        }),
      }),
    }),
  }),
}));

/** Una copia nuova del sito: il modulo riletto da zero, senza la memoria di prima. */
async function nuovaCopia() {
  vi.resetModules();
  return import('@/lib/ai/tettoSpesa');
}

describe('l errore del conto assente e uno all ora per tutto il sito, non per copia', () => {
  beforeEach(() => {
    righe.clear();
    errorMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('tre copie nate una dopo l altra nella stessa ora fanno un errore solo; passata l ora, un altro', async () => {
    for (let i = 0; i < 3; i++) {
      const copia = await nuovaCopia();
      await copia.spesaDiOggiCents();
      vi.setSystemTime(Date.now() + 5 * 60_000);
    }
    expect(errorMock, 'prima ogni copia nuova rifaceva l errore').toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61 * 60_000);
    const copia = await nuovaCopia();
    await copia.spesaDiOggiCents();
    expect(errorMock).toHaveBeenCalledTimes(2);
  });
});
