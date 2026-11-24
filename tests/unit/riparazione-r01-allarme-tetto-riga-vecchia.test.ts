import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * L'allarme del tetto di spesa AI conta i minuti del guasto da una riga di operational_alert_log
 * ('ai-tetto-condiviso:ripiego-da'), scritta al primo giro che trova il conto condiviso muto e
 * tolta quando torna a rispondere. La pulizia della memoria degli allarmi non la tocca, e la si
 * leggeva senza limite d'eta'; l'uscita senza tetto (o con l'AI spenta) non la toglieva. Rimasta da
 * un guasto vecchio, al primo guasto nuovo di cinque minuti l'allarme diceva «non risponde da tre
 * giorni».
 *
 * Qui il conto condiviso non risponde ADESSO, e la memoria degli allarmi ha una riga vecchia.
 */

const finti = vi.hoisted(() => ({
  aiAccesa: true,
  righe: new Map<string, string>(),
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
const oreFa = (ore: number) => new Date(ADESSO.getTime() - ore * 60 * 60_000).toISOString();

/** Un giro del cron su una copia nuova (la memoria della copia riparte da zero). */
async function giro(tettoEur = 20) {
  __azzeraRipiegoSpesaAi();
  return allarmiTettoSpesaAiPerIlCron({ tettoEur });
}

describe('l allarme del tetto non conta i minuti da una riga di un guasto vecchio', () => {
  beforeEach(() => {
    finti.righe.clear();
    finti.aiAccesa = true;
    vi.useFakeTimers();
    vi.setSystemTime(ADESSO);
  });
  afterEach(() => vi.useRealTimers());

  it('riga di tre giorni fa, guasto appena cominciato: niente «da tre giorni», e la riga riparte da adesso', async () => {
    finti.righe.set(CHIAVE_RIPIEGO_DA, oreFa(72));
    const allarmi = await giro();
    expect(allarmi.map((a) => a.detail).join(' '), 'al primo guasto l allarme conta i minuti dal guasto vecchio').not.toMatch(/non risponde da/);
    expect(allarmi).toHaveLength(0);
    expect(finti.righe.get(CHIAVE_RIPIEGO_DA)).toBe(ADESSO.toISOString());

    // Due ore dopo il guasto nuovo suona, con i minuti giusti.
    vi.setSystemTime(ADESSO.getTime() + 2 * 60 * 60_000);
    const dopo = await giro();
    expect(dopo).toHaveLength(1);
    expect(dopo[0].detail).toMatch(/non risponde da 120 min/);
  });

  it('un giro senza tetto o con l AI spenta toglie l inizio del guasto ricordato', async () => {
    finti.righe.set(CHIAVE_RIPIEGO_DA, oreFa(20));
    expect(await giro(0)).toEqual([]);
    expect(finti.righe.has(CHIAVE_RIPIEGO_DA), 'l uscita senza tetto lascia la riga del guasto').toBe(false);

    finti.righe.set(CHIAVE_RIPIEGO_DA, oreFa(20));
    finti.aiAccesa = false;
    expect(await giro()).toEqual([]);
    expect(finti.righe.has(CHIAVE_RIPIEGO_DA), 'l uscita con l AI spenta lascia la riga del guasto').toBe(false);

    // Tornati tetto e AI, il primo guasto di cinque minuti non suona.
    finti.aiAccesa = true;
    expect(await giro()).toHaveLength(0);
    vi.setSystemTime(ADESSO.getTime() + 5 * 60_000);
    expect(await giro()).toHaveLength(0);
  });

  it('CONTROLLO: un guasto vero di due ore, o di ventitre, suona coi suoi minuti', async () => {
    finti.righe.set(CHIAVE_RIPIEGO_DA, oreFa(2));
    const due = await giro();
    expect(due).toHaveLength(1);
    expect(due[0].detail).toMatch(/non risponde da 120 min/);

    finti.righe.set(CHIAVE_RIPIEGO_DA, oreFa(23));
    const ventitre = await giro();
    expect(ventitre).toHaveLength(1);
    expect(ventitre[0].detail).toMatch(/non risponde da 1380 min/);
    expect(finti.righe.get(CHIAVE_RIPIEGO_DA)).toBe(oreFa(23));
  });
});
