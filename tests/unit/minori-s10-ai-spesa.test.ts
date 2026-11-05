import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * S10 (5/11/2026, scheda 252) — il conto condiviso della spesa AI e' in
 * centesimi interi: una chiamata da 0,0006 € non deve valere un centesimo.
 */

const rpcMock = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

const centesimiRegistrati = () =>
  rpcMock.mock.calls
    .filter((c) => c[0] === 'registra_spesa_ai')
    .reduce((t, c) => t + Number((c[1] as { p_cents: number }).p_cents), 0);

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: 1, error: null });
  vi.resetModules();
});

describe('le chiamate piccole non contano un centesimo intero ciascuna (252)', () => {
  it('dieci chiamate da 0,0006 € registrano al massimo un centesimo', async () => {
    const { registraSpesaAi } = await import('@/lib/ai/run');
    for (let i = 0; i < 10; i++) await registraSpesaAi(0.0006);
    expect(centesimiRegistrati()).toBeLessThanOrEqual(1);
  });
  it('una chiamata da 2,5 centesimi più una da 0,6 ne registrano 3', async () => {
    const { registraSpesaAi } = await import('@/lib/ai/run');
    await registraSpesaAi(0.025);
    await registraSpesaAi(0.006);
    expect(centesimiRegistrati()).toBe(3);
  });
});
