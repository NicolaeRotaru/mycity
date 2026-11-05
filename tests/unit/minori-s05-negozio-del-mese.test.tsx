// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, type Domanda } from './aiuti/cabina-admin';

/**
 * S05 · schede 1818 e 264 — Negozio del mese in admin.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

async function apri(rispondi: (q: Domanda) => { data: unknown; error: unknown }) {
  fake.rispondi = rispondi;
  const mod = (await import('@/app/admin/shop-of-month/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}
const GIU = { data: null, error: { message: 'giù' } };

describe('Negozio del mese', () => {
  it('1818: se cade la lettura del mese, il salvataggio resta fermo e lo si dice', async () => {
    const host = await apri((q) => (q.tabella === 'shop_of_month' ? GIU : { data: [], error: null }));
    expect(host.textContent).toContain('Non riesco a leggere il pick di questo mese');
    const salva = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(salva.disabled).toBe(true);
  });

  it('1818: se cade la lettura dei voti non dice «Nessun voto»', async () => {
    const host = await apri((q) => (q.tabella === 'shop_of_month_leaderboard' ? GIU : { data: q.una ? null : [], error: null }));
    expect(host.textContent).not.toContain('Nessun voto registrato');
    expect(host.textContent).toContain('Non riesco a leggere i voti');
  });

  it('264: negozi a zero voti non fanno la classifica, e «Nessun voto» compare', async () => {
    const host = await apri((q) => (q.tabella === 'shop_of_month_leaderboard'
      ? { data: [{ seller_id: 's1', store_name: 'Pane Quotidiano', store_logo: null, vote_count: 0 }], error: null }
      : { data: q.una ? null : [], error: null }));
    expect(host.textContent).toContain('Nessun voto registrato per questo mese');
    expect(host.textContent).not.toMatch(/0 voti/);
  });
});
