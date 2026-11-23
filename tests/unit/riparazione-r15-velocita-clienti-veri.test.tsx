/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// PostHog e' spento al lancio (nessuna chiave): la velocita' vista dai clienti veri deve
// comunque essere misurata, dopo il consenso, e mandata a GA4.
const consenso = vi.hoisted(() => ({ analytics: true }));
const vitals = vi.hoisted(() => ({ cbs: {} as Record<string, (m: { value: number; rating: string }) => void> }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/consent', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  readConsent: () => (consenso.analytics ? { analytics: true, marketing: false } : { analytics: false, marketing: false }),
}));
vi.mock('web-vitals', () => {
  const on = (n: string) => (cb: (m: { value: number; rating: string }) => void) => {
    vitals.cbs[n] = cb;
  };
  return { onCLS: on('CLS'), onLCP: on('LCP'), onINP: on('INP'), onFCP: on('FCP'), onTTFB: on('TTFB') };
});

async function monta() {
  const { default: Provider } = await import('@/lib/analytics/posthog');
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    root.render(<Provider />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return root;
}

describe('la velocita\' vista dai clienti veri', () => {
  beforeEach(() => {
    vi.resetModules();
    vitals.cbs = {};
    consenso.analytics = true;
    (window as unknown as { gtag: unknown }).gtag = vi.fn();
  });
  afterEach(() => {
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it('con PostHog spento e il consenso dato, le misure arrivano a GA4', async () => {
    const root = await monta();
    expect(Object.keys(vitals.cbs).sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
    vitals.cbs.LCP({ value: 2400.4, rating: 'good' });
    const gtag = (window as unknown as { gtag: ReturnType<typeof vi.fn> }).gtag;
    expect(gtag).toHaveBeenCalledWith('event', 'web_vital', expect.objectContaining({ metric_name: 'LCP', value: 2400, metric_rating: 'good' }));
    await act(async () => root.unmount());
  });

  it('senza consenso statistico non misura e non manda niente', async () => {
    consenso.analytics = false;
    const root = await monta();
    expect(Object.keys(vitals.cbs)).toEqual([]);
    expect((window as unknown as { gtag: ReturnType<typeof vi.fn> }).gtag).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
