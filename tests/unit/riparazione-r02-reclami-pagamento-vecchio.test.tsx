// @vitest-environment jsdom
/**
 * Se la rilettura dei pagamenti cade mentre la finestra «Risolvi reclamo» è aperta, React Query tiene
 * i dati di prima: «Rimborsabile al massimo» restava quello vecchio senza dirlo. Adesso la finestra avvisa.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { focusManager } from '@tanstack/react-query';
import { disegna, aspetta } from './aiuti/cabina-admin';

const stato = vi.hoisted(() => ({ ordiniGiu: false }));
const RECLAMO = {
  id: 'rec-1', order_id: 'ord-rec-1-0000', opener_id: 'cliente-1', reason: 'damaged', description: 'Arrivata rotta',
  status: 'open', resolution_notes: null, refund_cents: null, created_at: '2026-11-01T10:00:00Z',
  opener: { full_name: 'Mario' }, against: { store_name: 'Forno', full_name: null },
};
const ORDINE = {
  id: 'ord-rec-1-0000', stripe_payment_intent: 'pi_1', payment_method: 'card', total_price: 40, gross_total_cents: 4000,
  wallet_applied_cents: 0, refunded_amount_cents: 0, cash_confirmed_at: null, payment_status: 'paid', delivery_status: 'delivered',
};
function catena(tabella: string): unknown {
  const risposta = () =>
    tabella === 'disputes' ? { data: [RECLAMO], error: null }
      : stato.ordiniGiu ? { data: null, error: { message: 'giù', code: 'PGRST000' } } : { data: [ORDINE], error: null };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve(risposta()).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (t: string) => catena(t), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; stato.ordiniGiu = false; focusManager.setFocused(undefined); });

describe('finestra dei reclami: pagamento vecchio', () => {
  it('se la rilettura dei pagamenti cade, avvisa pur mostrando il vecchio «Rimborsabile al massimo»', async () => {
    const mod = (await import('@/app/admin/disputes/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const decidi = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Decidi');
    await act(async () => { decidi?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    expect(document.body.textContent).toContain('Rimborsabile al massimo');
    expect(document.body.textContent).not.toContain('Non riesco a rileggere il pagamento');

    stato.ordiniGiu = true;
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await aspetta(10);
    expect(document.body.textContent).toContain('Rimborsabile al massimo');
    expect(document.body.textContent).toContain('Non riesco a rileggere il pagamento');
  });
});
