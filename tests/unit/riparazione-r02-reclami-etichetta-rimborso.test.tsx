// @vitest-environment jsdom
/** L'etichetta «Rimborso (€)» della finestra dei reclami è collegata al suo campo. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, aspetta } from './aiuti/cabina-admin';

const RECLAMO = {
  id: 'rec-1', order_id: 'ord-rec-1-0000', opener_id: 'cliente-1', reason: 'damaged', description: 'Arrivata rotta',
  status: 'open', resolution_notes: null, refund_cents: null, created_at: '2026-11-01T10:00:00Z',
  opener: { full_name: 'Mario' }, against: { store_name: 'Forno', full_name: null },
};
function catena(tabella: string): unknown {
  const risposta = () => (tabella === 'disputes' ? { data: [RECLAMO], error: null } : { data: [], error: null });
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
afterEach(() => { chiudi?.(); chiudi = null; });

describe('finestra dei reclami: etichetta del rimborso', () => {
  it('il campo si trova dal nome dell’etichetta', async () => {
    const mod = (await import('@/app/admin/disputes/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const decidi = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Decidi');
    await act(async () => { decidi?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    const etichetta = [...document.body.querySelectorAll('label')].find((l) => l.textContent?.includes('Rimborso (€)'));
    expect(etichetta).toBeTruthy();
    const id = etichetta?.getAttribute('for');
    expect(id, 'l’etichetta non ha htmlFor').toBeTruthy();
    const campo = document.getElementById(id as string);
    expect(campo?.tagName).toBe('INPUT');
    expect((campo as HTMLInputElement).type).toBe('number');
  });
});
