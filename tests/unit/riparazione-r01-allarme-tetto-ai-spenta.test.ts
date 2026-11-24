import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Il cron degli avvisi chiama l'allarme del tetto di spesa AI a ogni giro. La funzione usciva solo
 * se mancava il tetto, non se l'AI dei negozi era spenta: con AI_GLOBAL_DAILY_BUDGET_EUR impostata e
 * il conto condiviso che non risponde partiva l'allarme ogni sei ore, mentre lib/ai/client.ts
 * fermava ogni chiamata al modello (spendere era impossibile). Rumore sull'unico canale degli allarmi.
 *
 * Qui: tetto impostato, conto condiviso muto da due ore (ricordato nel database), e l'interruttore
 * dell'AI dei negozi spento o acceso.
 */

const finti = vi.hoisted(() => ({
  aiAccesa: false,
  righe: new Map<string, string>(),
  rpc: [] as string[],
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return {
    ...vero,
    get AI_NEGOZI_ACCESA() {
      return finti.aiAccesa;
    },
  };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string) => {
      finti.rpc.push(nome);
      return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    },
    // operational_alert_log finta: solo le colonne vere, alert_key e last_sent_at.
    from: () => ({
      upsert: (riga: { alert_key: string; last_sent_at: string }, o?: { ignoreDuplicates?: boolean }) => {
        const scritta = !(o?.ignoreDuplicates && finti.righe.has(riga.alert_key));
        if (scritta) finti.righe.set(riga.alert_key, riga.last_sent_at);
        const esito = { data: scritta ? [{ alert_key: riga.alert_key }] : [], error: null };
        return Object.assign(Promise.resolve(esito), { select: async () => esito });
      },
      update: () => ({ eq: () => ({ lt: () => ({ select: async () => ({ data: [], error: null }) }) }) }),
      select: () => ({
        eq: (_c: string, k: string) => ({
          maybeSingle: async () => ({ data: finti.righe.has(k) ? { last_sent_at: finti.righe.get(k) } : null, error: null }),
        }),
      }),
      delete: () => ({ eq: async (_c: string, k: string) => { finti.righe.delete(k); return { error: null }; } }),
    }),
  }),
}));

import { allarmiTettoSpesaAiPerIlCron, CHIAVE_RIPIEGO_DA, __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';

describe('con l AI dei negozi spenta l allarme del tetto di spesa AI non parte', () => {
  beforeEach(() => {
    __azzeraRipiegoSpesaAi();
    finti.righe.clear();
    finti.rpc.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    // Il conto condiviso non risponde dalle 10: due ore, oltre l'ora di tolleranza.
    finti.righe.set(CHIAVE_RIPIEGO_DA, '2026-11-24T10:00:00.000Z');
  });
  afterEach(() => vi.useRealTimers());

  it('AI spenta, tetto impostato, conto muto da due ore: nessun allarme e nessuna sonda', async () => {
    finti.aiAccesa = false;
    const allarmi = await allarmiTettoSpesaAiPerIlCron({ tettoEur: 20 });
    expect(allarmi, 'con l AI spenta spendere e impossibile: l allarme e solo rumore').toEqual([]);
    expect(finti.rpc, 'con l AI spenta il conto condiviso non si sonda').toEqual([]);
  });

  it('CONTROLLO: AI accesa, stesso guasto: l allarme parte', async () => {
    finti.aiAccesa = true;
    const allarmi = await allarmiTettoSpesaAiPerIlCron({ tettoEur: 20 });
    expect(allarmi).toHaveLength(1);
    expect(allarmi[0].detail).toMatch(/non risponde da 120 min/);
  });
});
