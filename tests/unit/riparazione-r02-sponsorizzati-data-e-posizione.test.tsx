// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

// R02-006 — la tabella delle sponsorizzazioni non deve scrivere «Invalid Date» (data mancante) né il
// codice grezzo del database (posizione che il sito non conosce ancora).
const BASE = {
  product_id: 'p1', seller_id: 's1', category_slug: null, daily_budget_cents: 500, spent_cents: 0,
  impressions: 0, clicks: 0, status: 'active', product: { name: 'Focaccia' }, seller: { store_name: 'Forno' },
};
const RIGHE = [
  { ...BASE, id: 'a', placement: 'home_top', start_date: null, end_date: undefined },
  { ...BASE, id: 'b', placement: 'footer_banner_nuovo', start_date: '2026-11-01', end_date: '2026-11-30' },
];
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then'
      ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: RIGHE, error: null, count: 2 }).then(ok)
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

describe('R02-006 · data mancante e posizione sconosciuta', () => {
  it('niente «Invalid Date» e niente codice grezzo', async () => {
    const mod = (await import('@/app/admin/sponsored/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const righe = Array.from(r.host.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');
    const tabella = righe.join(' | ');
    expect(righe.length).toBe(2);
    expect(tabella).not.toContain('Invalid Date');
    expect(tabella).toContain('— → —');
    expect(tabella).not.toContain('footer_banner_nuovo');
    expect(tabella).toContain('Altra posizione');
    expect(tabella).toContain('footer banner nuovo');
  });
});
