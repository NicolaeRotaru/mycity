// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * S05 · schede 1545 e 191 — il cruscotto «Oggi».
 */

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/lib/queries/cruscotto-oggi', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  leggiCruscottoOggi: async () => ({
    ordersTodayCount: 20000, gmvToday: 1, deliveredToday: 5, ordersPendingCount: 0, ordersProblemCount: 0,
    sellersPendingCount: 2, sosActiveCount: 0, disputesOpenCount: 0, signupsTodayCount: 0, recentOrders: [],
    finestraOrdiniRecentiGiorni: 7, campione: true,
  }),
}));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

describe('cruscotto Oggi', () => {
  it('1545: l’avviso del campione nomina anche i Consegnati; 191: «Seller pending» apre i negozi da approvare', async () => {
    const mod = (await import('@/app/admin/today/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    expect(r.host.textContent).toMatch(/consegnati qui sotto sono un campione/);
    expect(r.host.querySelector('a[href="/admin/users?role=pending"]')).not.toBeNull();
    expect(r.host.querySelector('a[href="/admin/users?role=seller"]')).toBeNull();
  });
});
