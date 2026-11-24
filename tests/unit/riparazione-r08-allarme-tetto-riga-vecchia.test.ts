import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R08-002. L'allarme del tetto di spesa AI conta i minuti del guasto da una riga di operational_alert_log
 * ('ai-tetto-condiviso:ripiego-da'), scritta al primo giro che trova il conto condiviso muto e
 * tolta quando torna a rispondere. La pulizia della memoria degli allarmi non la tocca, e la si
 * leggeva senza limite d'eta'; l'uscita senza tetto non la toglieva. Rimasta da
 * un guasto vecchio, al primo guasto nuovo di cinque minuti l'allarme diceva «non risponde da tre
 * giorni».
 *
 * Qui il conto condiviso non risponde ADESSO, e la memoria degli allarmi ha una riga vecchia.
 */

const finti = vi.hoisted(() => ({
  righe: new Map<string, string>(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }),
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

const ADESSO = new Date('2026-11-24T12:00:00Z');
const MIN = 60_000;
const oreFa = (ore: number) => new Date(ADESSO.getTime() - ore * 60 * MIN).toISOString();

/** Un giro del cron su una copia nuova (la memoria della copia riparte da zero). */
async function giro(tettoEur = 20) {
  __azzeraRipiegoSpesaAi();
  return allarmiTettoSpesaAiPerIlCron({ tettoEur });
}

describe('R08-002 l allarme del tetto non ripete i minuti di un guasto vecchio', () => {
  beforeEach(() => {
    finti.righe.clear();
    vi.useFakeTimers();
    vi.setSystemTime(ADESSO);
  });
  afterEach(() => vi.useRealTimers());

  it('un giro senza tetto toglie la riga di un guasto vecchio: il primo guasto vero dice minuti veri, non tre giorni', async () => {
    finti.righe.set(CHIAVE_RIPIEGO_DA, oreFa(72));
    expect(await giro(0)).toEqual([]);
    expect(finti.righe.has(CHIAVE_RIPIEGO_DA), 'il giro senza tetto lascia la riga del guasto').toBe(false);

    // Tetto di nuovo configurato: primo guasto, cinque minuti dopo ancora niente.
    expect(await giro()).toHaveLength(0);
    expect(finti.righe.get(CHIAVE_RIPIEGO_DA)).toBe(ADESSO.toISOString());
    vi.setSystemTime(ADESSO.getTime() + 5 * MIN);
    expect(await giro()).toHaveLength(0);

    // Un'ora e mezza dopo suona, coi minuti veri (90), non con quelli di tre giorni fa.
    vi.setSystemTime(ADESSO.getTime() + 90 * MIN);
    const dopo = await giro();
    expect(dopo).toHaveLength(1);
    expect(dopo[0].detail).toMatch(/non risponde da 90 min/);
    expect(dopo[0].detail).not.toMatch(/4[0-9]{3} min/);
  });

  it('CONTROLLO: un guasto continuo non permanente, cron ogni 5 minuti per 26 ore, dice 26 ore: nessun azzeramento', async () => {
    let ultimo: Awaited<ReturnType<typeof giro>> = [];
    for (let m = 0; m <= 26 * 60; m += 5) {
      vi.setSystemTime(ADESSO.getTime() + m * MIN);
      ultimo = await giro();
      if (m > 70) expect(ultimo, `a ${m} min l allarme tace`).toHaveLength(1);
    }
    expect(finti.righe.get(CHIAVE_RIPIEGO_DA)).toBe(ADESSO.toISOString());
    expect(ultimo[0].detail).toMatch(/non risponde da 1560 min/);
  });

  it('CONTROLLO: un guasto di due ore suona coi suoi minuti', async () => {
    finti.righe.set(CHIAVE_RIPIEGO_DA, oreFa(2));
    const due = await giro();
    expect(due).toHaveLength(1);
    expect(due[0].detail).toMatch(/non risponde da 120 min/);
  });
});
