import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * L'allarme del tetto di spesa AI diceva ancora «il tetto e' sceso a X € per copia» anche in
 * produzione, dove senza conto condiviso l'AI a pagamento ora si ferma del tutto. In produzione
 * l'allarme dice che l'AI e' ferma; in sviluppo il ripiego per copia resta, e il testo con lui.
 */
const rpcMock = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({ ...((await originale()) as object), AI_NEGOZI_ACCESA: true }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: () => ({
      upsert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

import { allarmiTettoSpesaAiPerIlCron, __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';

describe('il testo dell\'allarme del tetto di spesa AI senza conto condiviso', () => {
  beforeEach(() => {
    __azzeraRipiegoSpesaAi();
    rpcMock.mockReset();
    // Il conto condiviso non esiste: assenza permanente, allarme rosso subito.
    rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('in produzione dice che l\'AI e\' ferma, non «per copia»', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    const allarmi = await allarmiTettoSpesaAiPerIlCron({ tettoEur: 20, copieAttese: 4 });
    expect(allarmi).toHaveLength(1);
    expect(allarmi[0].detail).toMatch(/ferma per tutte le copie/);
    expect(allarmi[0].detail).not.toMatch(/per copia/);
    expect(allarmi[0].detail).not.toMatch(/5\.00 €/);
    expect(allarmi[0].detail).toMatch(/migrazione/);
  });

  it('in sviluppo resta il ripiego per copia, e il testo lo dice', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const allarmi = await allarmiTettoSpesaAiPerIlCron({ tettoEur: 20, copieAttese: 4 });
    expect(allarmi).toHaveLength(1);
    expect(allarmi[0].detail).toMatch(/sceso a 5,00\s€ per copia/);
    expect(allarmi[0].detail).not.toMatch(/ferma/);
  });
});
