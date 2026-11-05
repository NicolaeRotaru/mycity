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
  it('dieci chiamate da 0,0006 € registrano un centesimo, non dieci', async () => {
    const { registraSpesaAi } = await import('@/lib/ai/run');
    for (let i = 0; i < 10; i++) await registraSpesaAi(0.0006);
    expect(centesimiRegistrati()).toBe(1);
  });
  it('2,5 centesimi più 0,4 ne registrano 3 (per eccesso, mai sotto la spesa vera)', async () => {
    const { registraSpesaAi } = await import('@/lib/ai/run');
    await registraSpesaAi(0.025);
    await registraSpesaAi(0.004);
    expect(centesimiRegistrati()).toBe(3);
  });
  it('una spesa non arriva mai al conto per difetto', async () => {
    const { registraSpesaAi } = await import('@/lib/ai/run');
    let vero = 0;
    for (const eur of [0.0003, 0.0151, 0.0009, 0.0422, 0.0001]) {
      vero += eur * 100;
      await registraSpesaAi(eur);
      expect(centesimiRegistrati()).toBeGreaterThanOrEqual(vero - 1e-9);
    }
  });
});
