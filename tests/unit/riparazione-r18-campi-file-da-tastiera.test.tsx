/**
 * @vitest-environment jsdom
 *
 * R18-002 — I campi «scegli file» devono restare raggiungibili col Tab (non `hidden`, cioè
 * display:none), avere un nome accessibile e un anello di fuoco sul riquadro.
 * Giro di correzione (collaudo K07): anche il reso si monta, invece di cercare nel sorgente.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
// Un ordine consegnato due giorni fa, senza resi aperti: il modulo del reso si apre.
const ordineConsegnato = () => ({
  id: 'ordine-1', total_price: 30, delivered_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), delivery_status: 'DELIVERED',
  payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
});
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'g' } } }),
    },
    from: (tabella: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit', 'order']) q[m] = () => q;
      q.single = async () => ({ data: tabella === 'orders' ? ordineConsegnato() : null, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: 'ordine-1' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  CARICAMENTO_DA_FILE_ACCESO: true,
}));

import Pagina from '@/app/seller/products/import/page';
import PaginaReso from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('R18-002 campi file da tastiera', () => {
  it('importazione CSV: il campo non è hidden, ha un nome, il riquadro mostra il fuoco', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => { root.render(createElement(Pagina)); });
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    const input = box.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.classList.contains('hidden')).toBe(false);
    expect(input.hidden, 'l\'attributo hidden lo toglie dal Tab').toBe(false);
    expect(input.tabIndex, 'tabIndex -1 lo toglie dal Tab').not.toBe(-1);
    expect(input.classList.contains('sr-only')).toBe(true);
    expect(input.getAttribute('aria-label')).toBe('Scegli il file CSV');
    expect(input.closest('label')!.className).toContain('focus-within:ring-2');
    act(() => root.unmount());
    box.remove();
  });

  it('reso: montata la pagina, il campo non è hidden, ha un nome chiaro e il riquadro mostra il fuoco', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => { root.render(createElement(PaginaReso)); });
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    const input = box.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input, 'controprova: il modulo del reso si è aperto col campo delle foto').toBeTruthy();
    expect(input.classList.contains('hidden')).toBe(false);
    expect(input.hidden, 'l\'attributo hidden lo toglie dal Tab').toBe(false);
    expect(input.tabIndex, 'tabIndex -1 lo toglie dal Tab').not.toBe(-1);
    expect(input.classList.contains('sr-only')).toBe(true);
    expect(input.getAttribute('aria-label')).toBe('Aggiungi una foto alla richiesta di reso');
    const riquadro = input.closest('label')!;
    expect(riquadro.className).toContain('focus-within:ring-2');
    expect(riquadro.className).toContain('focus-within:ring-primary-700');
    act(() => root.unmount());
    box.remove();
  });
});
