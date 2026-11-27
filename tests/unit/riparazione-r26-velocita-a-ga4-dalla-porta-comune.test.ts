/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La misura di velocita' mandava a GA4 da una porta sua. Adesso passa dall'aiutante comune,
 * che il consenso lo rilegge da se': se il consenso e' stato tolto, GA4 non riceve niente.
 */
const stato = vi.hoisted(() => ({ risposte: [] as boolean[], chiamate: 0 }));

vi.mock('@/lib/consent', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  readConsent: () => {
    const v = stato.risposte[Math.min(stato.chiamate++, stato.risposte.length - 1)];
    return { analytics: v, marketing: false };
  },
}));

describe('misura di velocita' + "' verso GA4", () => {
  const gtag = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    gtag.mockClear();
    stato.chiamate = 0;
    (window as unknown as { gtag: unknown }).gtag = gtag;
  });

  it('con il consenso passa, con i numeri attesi', async () => {
    stato.risposte = [true];
    const { mandaMisuraDiVelocita } = await import('@/lib/analytics/posthog');
    mandaMisuraDiVelocita('CLS', { value: 0.1234, rating: 'good' });
    expect(gtag).toHaveBeenCalledWith('event', 'web_vital', {
      metric_name: 'CLS', value: 123, metric_rating: 'good', non_interaction: true,
    });
  });

  it('senza consenso non parte', async () => {
    stato.risposte = [false];
    const { mandaMisuraDiVelocita } = await import('@/lib/analytics/posthog');
    mandaMisuraDiVelocita('LCP', { value: 1800, rating: 'good' });
    expect(gtag).not.toHaveBeenCalled();
  });

  it('se il consenso sparisce subito dopo il primo controllo, la porta di GA4 lo rilegge e si ferma', async () => {
    stato.risposte = [true, false];
    const { mandaMisuraDiVelocita } = await import('@/lib/analytics/posthog');
    mandaMisuraDiVelocita('LCP', { value: 1800, rating: 'good' });
    expect(gtag).not.toHaveBeenCalled();
  });
});
