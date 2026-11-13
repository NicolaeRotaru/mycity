// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-001 — Il pannello dei bonifici, disegnato: il primo riquadro deve dire
 * quanto versare a mano (contanti con la rimessa confermata, al netto degli
 * storni), non sommare contanti ancora dal fattorino, ritiri pagati al banco e
 * storni non riusciti. Orologio finto: lunedì 16/11/2026.
 */

const stato = vi.hoisted(() => ({ righe: [] as unknown[] }));
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: stato.righe, error: null }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => catena(), rpc: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T08:00:00Z'));
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
});

const riga = (id: string, extra: Record<string, unknown>) => ({
  id, seller_id: 'forno', total_price: 20, seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
  payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
  payment_method: 'cod', created_at: '2026-11-10T09:00:00Z', delivered_at: '2026-11-12T15:00:00Z',
  seller: { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' },
  ...extra,
});

describe('R11-001 — il pannello dei bonifici disegnato', () => {
  it('il primo riquadro è quanto versare a mano, al netto degli storni', async () => {
    stato.righe = [
      riga('a1', { seller_payout_reversed_cents: 500 }), // rimessa confermata, rimborso parziale: 13 €
      riga('a2', { payout_status: 'AWAITING_REMITTANCE' }), // contanti ancora dal fattorino
      riga('a3', { payout_status: 'CASH_IN_STORE' }), // ritiro pagato al banco
      riga('a4', { payout_status: 'REVERSAL_FAILED' }), // storno non riuscito
    ];
    const mod = (await import('@/app/admin/payouts/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const riquadri = Array.from(r.host.querySelectorAll('p.text-\\[26px\\]')).map((p) => p.textContent ?? '');
    expect(riquadri[0], 'il primo riquadro somma soldi che il negozio non deve ricevere da Nicola').toMatch(/13,00/);
    expect(r.host.textContent, 'l IBAN intero serve per fare il bonifico').toContain('IT60X0542811101000000123456');
  });
});
