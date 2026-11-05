// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * S10 (5/11/2026, scheda 644) — chi accetta i cookie dopo essere entrato non
 * perde la pagina d'ingresso né il segno di sessione nuova.
 */

const consenso = vi.hoisted(() => ({ analytics: false }));
vi.mock('@/lib/consent', () => ({ hasConsent: (c: string) => (c === 'analytics' ? consenso.analytics : true) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/store/forno', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));

import ActivityTracker from '@/components/ActivityTracker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('la pagina d\'ingresso arriva anche se il sì ai cookie viene dopo (644)', () => {
  it('senza consenso niente; al sì parte la pagina corrente con new_session', async () => {
    const corpi: Array<Record<string, unknown>> = [];
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (_u: string, b: Blob) => {
        void b.text().then((t) => corpi.push(JSON.parse(t)));
        return true;
      },
    });
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => root.render(createElement(ActivityTracker)));
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(corpi.filter((x) => x.event_type === 'page_view')).toHaveLength(0);

    consenso.analytics = true;
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mc:consent-change', { detail: { analytics: true } }));
      await new Promise((r) => setTimeout(r, 5));
    });
    const viste = corpi.filter((x) => x.event_type === 'page_view');
    expect(viste).toHaveLength(1);
    expect(viste[0].metadata).toEqual({ new_session: true });
    await act(async () => root.unmount());
  });
});
