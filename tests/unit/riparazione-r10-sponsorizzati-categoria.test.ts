// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

// R10-003 — Nella tabella delle sponsorizzazioni, accanto a «In cima alla categoria», restava lo slug
// grezzo del database («· casa-tessili»). Deve comparire il nome della categoria, come lo legge chi
// amministra; il valore nel database resta lo slug.
const CAMPAGNA = {
  id: 'c1', product_id: 'p1', seller_id: 's1', placement: 'category_top', category_slug: 'casa-tessili',
  start_date: '2026-11-01', end_date: '2026-11-30', daily_budget_cents: 500, spent_cents: 120,
  impressions: 1000, clicks: 30, status: 'active',
  product: { name: 'Lenzuola di lino' }, seller: { store_name: 'Casa Bella' },
};
const CATEGORIE = [{ slug: 'casa-tessili', name: 'Tessili & Biancheria' }];

function catena(tabella: string): unknown {
  const righe = tabella === 'categories' ? CATEGORIE : [CAMPAGNA];
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then'
      ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: righe, error: null, count: righe.length }).then(ok)
      : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (t: string) => catena(t) } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

describe('R10-003 · accanto alla posizione la categoria ha il suo nome, non lo slug', () => {
  it('la riga dice «In cima alla categoria · Tessili & Biancheria», senza «casa-tessili»', async () => {
    const mod = (await import('@/app/admin/sponsored/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const tabella = r.host.querySelector('table')?.textContent ?? '';
    expect(tabella).toContain('Lenzuola di lino');
    expect(tabella).toContain('In cima alla categoria');
    expect(tabella).toContain('Tessili & Biancheria');
    expect(tabella).not.toContain('casa-tessili');
  });
});
