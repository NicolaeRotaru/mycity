// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, aspetta } from './aiuti/cabina-admin';

/**
 * S05 · scheda 1603 — «Elimina campagna» cancellava al primo tocco, su un
 * bersaglio di 16 punti. Ora chiede conferma, come i coupon.
 */

const stato = vi.hoisted(() => ({ cancellazioni: 0 }));
const CAMPAGNA = {
  id: 'c1', product_id: 'p1', seller_id: 's1', placement: 'home', category_slug: null, start_date: '2026-11-01',
  end_date: '2026-11-30', daily_budget_cents: 500, spent_cents: 0, impressions: 0, clicks: 0, status: 'active',
  product: { name: 'Focaccia' }, seller: { store_name: 'Forno' },
};
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === 'then') return (ok: (r: unknown) => unknown) => Promise.resolve({ data: [CAMPAGNA], error: null, count: 1 }).then(ok);
      if (k === 'delete') return () => { stato.cancellazioni += 1; return p; };
      return () => p;
    },
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => catena() } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

describe('campagne sponsorizzate', () => {
  it('1603: il tocco su «Elimina» non cancella senza conferma, e il bersaglio è alto 44 px', async () => {
    const mod = (await import('@/app/admin/sponsored/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const elimina = r.host.querySelector('button[aria-label^="Elimina la campagna"]') as HTMLButtonElement;
    expect(elimina).not.toBeNull();
    expect(elimina.className).toContain('min-h-[44px]');
    await act(async () => { elimina.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    expect(stato.cancellazioni, 'la campagna è stata cancellata senza chiedere').toBe(0);
  });
});
