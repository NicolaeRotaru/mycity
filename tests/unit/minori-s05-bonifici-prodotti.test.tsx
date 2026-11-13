// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * S05 · schede 1801, 1802, 1800, 1817, 1821, 1824 — bonifici e prodotti in admin.
 */

const stato = vi.hoisted(() => ({ righe: [] as unknown[] }));
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: stato.righe, error: null }).then(ok) : () => p),
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

const ordine = (i: number) => ({
  id: `ord${String(i).padStart(5, '0')}-x`, seller_id: 'forno', total_price: 10, seller_payout_cents: 900,
  payout_status: 'HELD', payout_at: '2026-11-09T09:00:00Z', stripe_transfer_id: null, delivery_status: 'DELIVERED',
  payment_method: 'card', created_at: '2026-11-01T09:00:00Z', delivered_at: '2026-11-03T15:00:00Z',
  seller: { store_name: 'Forno', billing_iban: null },
});

async function apri(percorso: string) {
  const mod = (await import(percorso)) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('bonifici ai negozi', () => {
  it('1801: con 1000 righe esatte nessun «Elenco tagliato»', async () => {
    stato.righe = Array.from({ length: 1000 }, (_, i) => ordine(i));
    const host = await apri('@/app/admin/payouts/page');
    expect(host.textContent).not.toContain('Elenco tagliato');
  });

  it('1802/1800/1817: oltre il tetto l’avviso sta prima dei riquadri, dice chi manca, e le cifre sono «almeno»', async () => {
    stato.righe = Array.from({ length: 1001 }, (_, i) => ordine(i));
    const host = await apri('@/app/admin/payouts/page');
    const testo = host.textContent ?? '';
    expect(testo.indexOf('Elenco tagliato')).toBeLessThan(testo.indexOf('Contanti da versare'));
    expect(testo).toMatch(/Mancano i più\s+vecchi/);
    expect(testo).toMatch(/anche quelli dei singoli\s+negozi/);
    expect(testo).toMatch(/almeno /);
  });

  it('1821: la colonna «Consegnato» mostra la data di consegna, non quella del bonifico', async () => {
    stato.righe = [ordine(1)];
    const host = await apri('@/app/admin/payouts/page');
    const cella = host.querySelector('tbody tr td:nth-child(2)')?.textContent ?? '';
    expect(cella).toMatch(/3/);
    expect(cella).not.toMatch(/9/);
  });
});

describe('prodotti', () => {
  it('1824: lo stato è in italiano; 1801: 1000 righe esatte non sono «1000+»', async () => {
    stato.righe = Array.from({ length: 1000 }, (_, i) => ({
      id: `p${i}`, name: `Pane ${i}`, price: 2, stock: 3, status: i === 0 ? 'available' : 'sold', images: [],
      external_marketplace: null, external_synced_at: null, seller: { store_name: 'Forno' }, categories: null,
    }));
    const host = await apri('@/app/admin/products/page');
    expect(host.textContent).toContain('in vendita');
    expect(host.textContent).not.toMatch(/\bavailable\b/);
    expect(host.textContent).not.toContain('Elenco tagliato');
    expect(host.textContent).not.toMatch(/1000\+/);
  });
});
