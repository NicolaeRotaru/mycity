// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-013 — In Guadagni le barre del grafico dei sette giorni restavano a zero
 * (la colonna non aveva un'altezza, quindi il % della barra non aveva
 * riferimento), e lo stato del bonifico compariva come codice («REVERSAL_FAILED»)
 * o in gergo («Completa onboarding»).
 */

const oggi = new Date().toISOString();
const stato = vi.hoisted(() => ({ righe: [] as unknown[] }));
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: stato.righe, error: null }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: () => catena(), auth: { getUser: async () => ({ data: { user: { id: 'forno' } } }), getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/seller/StripeConnectButton', () => ({ default: () => null }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

const ordine = (id: string, payout_status: string) => ({
  id, total_price: 63, created_at: oggi, delivery_status: 'DELIVERED', payment_method: 'card', payment_status: 'PAID',
  payout_status, payout_at: null, seller_payout_cents: 5670, seller_payout_reversed_cents: 0, refunded_amount_cents: 0,
  application_fee_cents: 630, stripe_transfer_id: null, stripe_reversal_id: null, pickup_in_store: false, billing_iban: 'IT00',
});

describe('R11-013 — Guadagni', () => {
  it('nessun codice tecnico né gergo nelle targhette del bonifico', async () => {
    stato.righe = [ordine('o-1', 'REVERSAL_FAILED'), ordine('o-2', 'PENDING_SELLER_ONBOARDING'), ordine('o-3', 'STATO_NUOVO')];
    const mod = (await import('@/app/seller/earnings/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const testo = r.host.textContent ?? '';
    expect(testo, 'il negozio legge il codice grezzo REVERSAL_FAILED').not.toContain('REVERSAL_FAILED');
    expect(testo).not.toContain('STATO_NUOVO');
    expect(testo).not.toContain('Completa onboarding');
    expect(testo).toContain('Collega il conto');
  });

  it('le colonne del grafico hanno un altezza, così la barra in % si vede', async () => {
    stato.righe = [ordine('o-1', 'HELD')];
    const mod = (await import('@/app/seller/earnings/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const barra = r.host.querySelector('[title][style*="height"]');
    const colonna = barra?.parentElement?.parentElement;
    expect(colonna?.className ?? '', 'la colonna flex-1 senza altezza lascia la barra a 0 px').toMatch(/\bh-full\b/);
  });
});
