// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

// R09-018 — Nella tabella delle sponsorizzazioni intestazioni in inglese («Placement», «Impressions»,
// «CTR»), codici del database («home_top») e la percentuale col punto («3.55%»).
const CAMPAGNA = {
  id: 'c1', product_id: 'p1', seller_id: 's1', placement: 'home_top', category_slug: null, start_date: '2026-11-01',
  end_date: '2026-11-30', daily_budget_cents: 500, spent_cents: 120, impressions: 1000, clicks: 35.5, status: 'active',
  product: { name: 'Focaccia' }, seller: { store_name: 'Forno' },
};
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then'
      ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: [CAMPAGNA], error: null, count: 1 }).then(ok)
      : () => p),
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

describe('R09-018 · la tabella delle sponsorizzazioni è in italiano', () => {
  it('niente codici né intestazioni inglesi, percentuale con la virgola', async () => {
    const mod = (await import('@/app/admin/sponsored/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const tabella = r.host.querySelector('table')?.textContent ?? '';
    expect(tabella).toContain('In cima alla home');
    expect(tabella).not.toContain('home_top');
    for (const parola of ['Placement', 'Impressions', 'CTR', 'Seller', 'Budget/g']) expect(tabella).not.toContain(parola);
    expect(tabella).toContain('3,55%');
    expect(tabella).not.toContain('3.55%');
  });
});
