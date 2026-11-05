// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { fake, disegna, scrivi, aspetta } from './aiuti/cabina-admin';
import { CODICI_SCONTO_IN_CASSA } from '@/lib/funzioni-al-lancio';

/**
 * S05 · schede 331 e 1951 — pagina dei codici sconto.
 * ① Coi codici spenti in cassa la pagina lo dice, e il badge non dice solo «Attivo».
 * ② Il tipo «Spedizione gratuita» avvisa che sotto una certa spesa copre solo una parte.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const COUPON = {
  id: 'c1', code: 'BENVENUTO', type: 'PERCENT', value: 10, min_subtotal: 0, max_uses: null, uses_count: 0,
  active: true, first_order_only: false, description: null, expires_at: null, starts_at: null, created_at: '2026-11-01T00:00:00Z',
};

async function apri() {
  fake.rispondi = () => ({ data: [COUPON], error: null });
  const mod = (await import('@/app/admin/coupons/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('codici sconto in admin', () => {
  it('331: coi codici spenti in cassa c’è la striscia e il badge lo dice', async () => {
    expect(CODICI_SCONTO_IN_CASSA, 'la prova vale al lancio, coi codici spenti').toBe(false);
    const host = await apri();
    expect(host.textContent).toContain('I codici sono spenti in cassa');
    expect(host.textContent).toContain('Attivo (spento in cassa)');
  });

  it('1951: scegliendo «Spedizione gratuita» compare l’avviso sulla copertura parziale', async () => {
    const host = await apri();
    const nuovo = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Nuovo coupon'));
    await act(async () => { nuovo?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    const tipo = host.querySelector('select') as HTMLSelectElement;
    await scrivi(tipo, 'FREE_SHIPPING');
    expect(host.textContent).toMatch(/Toglie tutta la consegna solo da .*€/);
    expect(host.textContent).toContain('paga comunque una parte');
  });
});
