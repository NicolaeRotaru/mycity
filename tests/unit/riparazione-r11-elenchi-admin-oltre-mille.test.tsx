// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-011 — Il server restituisce al massimo 1.000 righe (max-rows): la «riga in
 * più» (TETTO + 1) non arrivava mai. Con 1.233 prodotti si leggeva «1000 di 1000»
 * senza avviso, e lo stesso nel pannello dei bonifici. Qui il finto server fa come
 * quello vero: mai più di mille righe, e il conteggio esatto quando lo si chiede.
 */

const stato = vi.hoisted(() => ({ righe: [] as unknown[], totale: 0 }));
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) =>
      k === 'then'
        ? (ok: (r: unknown) => unknown) =>
            Promise.resolve({ data: stato.righe.slice(0, 1000), error: null, count: stato.totale }).then(ok)
        : () => p,
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => catena(), rpc: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

async function apri(percorso: string) {
  const mod = (await import(percorso)) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('R11-011 — elenchi admin oltre le mille righe', () => {
  it('prodotti: con 1.233 prodotti veri l elenco si dice tagliato', async () => {
    stato.totale = 1233;
    stato.righe = Array.from({ length: 1233 }, (_, i) => ({
      id: `p${i}`, name: `Pane ${i}`, price: 2, stock: 3, status: 'available', images: [],
      external_marketplace: null, external_synced_at: null, seller: { store_name: 'Forno' }, categories: null,
    }));
    const host = await apri('@/app/admin/products/page');
    expect(host.textContent, '«1000 di 1000» con 1.233 prodotti veri, senza avviso').toContain('Elenco tagliato');
    expect(host.textContent).toContain('1233');
  });

  it('bonifici: con più di mille ordini consegnati le cifre sono «almeno»', async () => {
    stato.totale = 1500;
    stato.righe = Array.from({ length: 1500 }, (_, i) => ({
      id: `o${i}`, seller_id: 'forno', total_price: 10, seller_payout_cents: 900, seller_payout_reversed_cents: 0,
      payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
      payment_method: 'card', created_at: '2026-11-01T09:00:00Z', delivered_at: '2026-11-03T15:00:00Z',
      seller: { store_name: 'Forno', billing_iban: null },
    }));
    const host = await apri('@/app/admin/payouts/page');
    expect(host.textContent).toContain('Elenco tagliato');
    expect(host.textContent).toMatch(/almeno /);
  });
});

describe('R11-012 — collaudo K04: oltre il tetto ogni cifra è un minimo', () => {
  it('anche «già pagati» del singolo negozio porta «almeno»', async () => {
    stato.totale = 1500;
    stato.righe = Array.from({ length: 1500 }, (_, i) => ({
      id: `o${i}`, seller_id: 'forno', total_price: 10, seller_payout_cents: 900, seller_payout_reversed_cents: 0,
      payout_status: 'TRANSFERRED', payout_at: '2026-11-04T10:00:00Z', stripe_transfer_id: 'tr_x', delivery_status: 'DELIVERED',
      payment_method: 'card', created_at: '2026-11-01T09:00:00Z', delivered_at: '2026-11-03T15:00:00Z',
      seller: { store_name: 'Forno', billing_iban: null },
    }));
    const host = await apri('@/app/admin/payouts/page');
    expect(host.textContent, 'la cifra parziale del negozio si legge come esatta').toMatch(/almeno [^a-z]*già pagati/);
  });
});
