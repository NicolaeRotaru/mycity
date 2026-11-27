/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Al consenso statistico PostHog si avviava due o tre volte in parallelo
 * (consenso, primo evento, pagina vista chiamano tutti insieme). Adesso un avvio solo.
 */
const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  POSTHOG_ACCESO: true,
}));
vi.mock('@/lib/consent', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  readConsent: () => ({ analytics: true, marketing: false }),
}));

describe('PostHog si avvia una volta sola', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_finta');
    posthog.init.mockClear();
    posthog.capture.mockClear();
  });

  it('tre chiamate in parallelo, un solo init, e tutti gli eventi partono', async () => {
    const m = await import('@/lib/analytics/posthog');
    await Promise.all([m.track('a'), m.track('b'), m.identify('u1')]);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledTimes(2);
  });

  it('dopo l\'avvio le chiamate successive non riavviano', async () => {
    const m = await import('@/lib/analytics/posthog');
    await Promise.all([m.track('a'), m.track('b')]);
    await m.track('c');
    expect(posthog.init).toHaveBeenCalledTimes(1);
  });
});
